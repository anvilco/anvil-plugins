# BoldSign Template Migration Reference

How to migrate BoldSign templates into Anvil. BoldSign templates are **flat PDFs
with positioned form fields** (each field placed by absolute `bounds` on a
`pageNumber`), so the default path is a **PDF download + Anvil Document AI**
re-detection — the same approach the DropboxSign plugin uses. A **dynamic-doc**
target is offered as an optional fidelity upgrade for content-heavy templates.

---

## Overview

1. Inventory templates in BoldSign
2. Export each template's PDF + field/role metadata (the bundled script)
3. Choose a target per template (PDF + Document AI is the default)
4. Import to Anvil
5. Map roles → signer IDs, fields → aliases, prefill → data
6. Create an old → new ID mapping
7. Generate a database migration
8. Publish + verify each Anvil template

---

## Two migration targets (tiered)

### Target B — PDF + Document AI (default, recommended)

Download the template's PDF from BoldSign and upload it as an ordinary PDF Cast,
letting Anvil's Document AI detect fields — then re-tag using the exported field
manifest (types, pages, positions).

- Uses only the **stable public** `createCast` PDF path.
- **Preserves the exact layout** BoldSign already froze into the PDF.
- Best for BoldSign's PDF-native templates — which is essentially all of them.

This is the right choice for a straight migration. Reach for Target A only when a
template would genuinely benefit from reflowing content or repeating tables.

### Target A — Dynamic doc (optional, higher fidelity)

An Anvil **dynamic document** is a Cast whose content is a structured block/node
tree (headings, paragraphs, lists, tables) with **inline field nodes**, authored via
the API rather than uploaded as a PDF.

| BoldSign template | Dynamic doc |
|-------------------|-------------|
| Fixed PDF body | `content` node tree (`paragraph`, `heading`, `bulletList`, `table`) |
| Positioned form field | inline typed `field` node (`signature`, `shortText`, `date`, …) |
| Prefill (`value`) | fill data on the field node's `aliasId` |
| (no equivalent) | repeating table rows bound to an array data key |

**Why it's higher fidelity:** it preserves *semantic structure* — real headings,
reflowing text, tables, re-editable content — instead of a frozen page image.

**The honest tradeoff:** BoldSign has **no content-tree export**, so a dynamic doc
is a **rebuild**, not a conversion — you regenerate the document's structure as
Anvil's internal content-tree JSON (a TipTap/ProseMirror node tree). That format is
**not a public, versioned contract** — pin your generator to the node types you use
and re-verify after Anvil upgrades. Treat Target A as higher-fidelity,
higher-maintenance.

#### How to author a dynamic doc (create → update → publish)

There is no content argument on `createCast`, so it's a three-step flow:

```typescript
import Anvil from '@anvilco/anvil'
const anvil = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

// 1. Create an EMPTY dynamic doc (uploaded bytes are ignored; the mimetype
//    selects the dynamic-document type).
const emptyFile = Anvil.prepareGraphQLFile(Buffer.from(''), {
  filename: 'new-document.pdf',
  mimetype: 'application/vnd.anvil.document.v1+json',
})
const { data: created } = await anvil.requestGraphQL({
  query: `mutation ($file: Upload!, $title: String) {
    createCast(file: $file, title: $title, isTemplate: true) { eid }
  }`,
  variables: { file: emptyFile, title: 'NDA' },
})
const castEid = created?.data?.createCast?.eid

// 2. Set the content tree. The config MUST have a "content" key.
const config = {
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Mutual NDA' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'This agreement is between ' },
      // A former Textbox/Label field → an inline field node:
      { type: 'field', attrs: { id: 'f_company', type: 'shortText', name: 'Company Name', aliasId: 'companyName' } },
      { type: 'text', text: ' and Acme Inc.' },
    ] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Signature: ' },
      { type: 'field', attrs: { id: 'f_sig', type: 'signature', name: 'Client Signature', aliasId: 'clientSignature' } },
    ] },
  ],
}
await anvil.requestGraphQL({
  query: `mutation ($eid: String!, $config: JSON) { updateCast(eid: $eid, config: $config) { eid } }`,
  variables: { eid: castEid, config },
})

// 3. Publish so it can be used in fillPDF / createEtchPacket.
await anvil.requestGraphQL({
  query: `mutation ($eid: String!) { publishCast(eid: $eid) { eid } }`,
  variables: { eid: castEid },
})
```

- **Fields fill by `aliasId`** with the same `data`/`fillPDF` mechanism as a PDF
  Cast — a former prefill value and a former signer field are both field nodes.
- **E-sign binding is identical to a PDF Cast:** a signer's
  `fields: [{ fileId, fieldId }]` references the field's `aliasId`. Signature,
  initial, and date field types are first-class in dynamic docs.
- **No signatures/interactive fields inside a repeating row** — keep signature
  fields outside repeats.

### Choosing (the tiered rule)

| Template characteristic | Target |
|-------------------------|--------|
| PDF-origin, fixed layout (the BoldSign norm) | **B — PDF + Document AI** |
| You want the least-maintenance, stable-API path | **B — PDF + Document AI** |
| Content-heavy, needs reflow / real tables / re-editable in Anvil | **A — dynamic doc** |
| Repeating line-item tables (no signatures inside) | **A — dynamic doc** |

The choice is per template. When unsure, default to **B** — it's a faithful
migration of what BoldSign already has. Use **A** only where structural
fidelity/editability clearly matters.

---

## Step 1: Inventory templates

List templates from BoldSign to understand what needs to migrate.

```bash
curl -H "X-API-KEY: $BOLDSIGN_API_KEY" \
  "https://api.boldsign.com/v1/template/list?page=1&pageSize=100"
```

The bundled `scripts/export-boldsign-templates.ts` does this for you. For each
template, note: template ID, title, roles, and form fields (types + positions).

Ask the developer: **"Do you want to migrate all templates, or just specific ones?
If some are deprecated, we can skip them."**

---

## Step 2: Export templates (PDF + metadata)

Use the bundled `scripts/export-boldsign-templates.ts`. It:

1. Authenticates with `BOLDSIGN_API_KEY` (US host by default; pass `--region eu`
   or `--base-url` for EU).
2. Lists templates (`GET /v1/template/list`) or the specific IDs you pass.
3. For each template, downloads its PDF (`GET /v1/template/download`) and reads its
   properties (`GET /v1/template/properties`) to capture roles and form fields
   (type, page, `bounds`).
4. Writes one `<title>.pdf` per template plus a `boldsign-template-manifest.json`
   with the metadata for the ID mapping and field re-tagging.

```bash
cp scripts/export-boldsign-templates.ts ./scripts/

# All templates (US region)
npx ts-node scripts/export-boldsign-templates.ts --output-dir ./migrated-templates

# Specific templates, EU region
npx ts-node scripts/export-boldsign-templates.ts \
  --output-dir ./migrated-templates \
  --template-ids "tmpl_abc,tmpl_def" --region eu

# Dry run — list without downloading
npx ts-node scripts/export-boldsign-templates.ts --output-dir ./out --dry-run
```

The manifest shape:

```json
{
  "exportedAt": "2026-08-19T...",
  "region": "us",
  "templates": [
    {
      "templateId": "tmpl_abc123",
      "title": "NDA Template",
      "pdfFilename": "NDA_Template.pdf",
      "roles": [
        { "roleIndex": 1, "name": "Customer", "signerOrder": 1 }
      ],
      "formFields": [
        { "id": "CompanyName", "name": "CompanyName", "fieldType": "Textbox", "pageNumber": 1,
          "bounds": { "x": 153, "y": 230, "width": 84, "height": 11 }, "isRequired": false,
          "role": "Customer" },
        { "id": "Signature", "name": "Signature", "fieldType": "Signature", "pageNumber": 3,
          "bounds": { "x": 191, "y": 148, "width": 120, "height": 30 }, "isRequired": true,
          "role": "Customer" }
      ],
      "status": "success"
    }
  ]
}
```

Review the manifest with the developer and decide a target per template.

---

## Step 3: Import per target

- **Target B (PDF + Document AI):** upload the exported PDFs with the
  `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts` (which runs
  `createCast` with `advancedDetectFields` for Document AI field detection), then
  re-tag fields in the Anvil editor using the manifest's field positions/types.

  ```bash
  # With field alias suggestions from your schema
  npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates --schema ./extracted-schema.json
  # Or without schema
  npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates
  ```

  It writes `anvil-migration-manifest.json` with each new `castEid`.

- **Target A (dynamic doc):** build the content tree from the manifest (body →
  content nodes, fields → inline field nodes by `aliasId`, roles → signer
  assignments) and run create → `updateCast` → `publishCast` (above).

---

## Step 4: Map roles, fields, prefill

| BoldSign | Anvil |
|----------|-------|
| Role (`roleIndex` / `signerRole`, e.g. "Customer") | Signer id (e.g. `Customer` → `customer`) |
| Form field (`id`/`name`, assigned to a role) | Field alias, assigned to that signer |
| Form field `value` / `existingFormFields` | Fill-data key (`data.payloads`) |
| `signerOrder` | `routingOrder` |

Set aliases in the Anvil template editor. If you ran `migrate-pdfs-to-anvil.ts`
with a schema, they may already be pre-populated. Confirm each signature/date/initial
field is assigned to the correct signer.

---

## Step 5: ID mapping + database migration

Combine the BoldSign manifest and the Anvil import manifest into
`template-id-mapping.json` (BoldSign `templateId` → Anvil `castEid`):

```json
{
  "mappings": [
    {
      "boldSignTemplateId": "tmpl_abc123",
      "boldSignTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "roleMappings": { "Customer": "customer" },
      "fieldMappings": { "CompanyName": "companyName", "Signature": "signature" }
    }
  ]
}
```

Then generate a DB migration that adds Anvil EID columns (`cast_eid`,
`etch_packet_eid`) **alongside** the existing BoldSign columns and populates
`cast_eid` from the mapping.

**Detect the developer's migration framework** and match it:
- `prisma/schema.prisma` → Prisma migration
- `knexfile.{js,ts}` → Knex migration
- Sequelize-style `migrations/*` with `queryInterface` → Sequelize migration
- TypeORM `data-source.ts` → TypeORM migration
- None detected → raw SQL

```sql
-- Raw SQL example
ALTER TABLE signing_requests ADD COLUMN cast_eid VARCHAR(255);
ALTER TABLE signing_requests ADD COLUMN etch_packet_eid VARCHAR(255);
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE boldsign_template_id = 'tmpl_abc123';
-- ... one UPDATE per mapping entry
```

**The developer runs the migration** — do not run it automatically. Tell them:
**"I've generated the migration at [path]. It adds Anvil EID columns alongside your
BoldSign columns and populates them from the template ID mapping. Please review and
run it when you're ready."**

---

## Step 6: Publish + verify

For each imported Cast:

1. Open it at `https://app.useanvil.com`.
2. Review field tagging, aliases, and positions against the manifest — confirm they
   match your data model.
3. Confirm each field's signer assignment.
4. Click **Publish** — unpublished templates return an error from `fillPDF` /
   `createEtchPacket`.

Verify the fields programmatically with `cast(eid) { config }` (see `api-mapping.md`
→ "Listing & Reading Anvil Templates") and run a test `fillPDF` to confirm data
fills before moving on to code migration. To list everything already in the org
(e.g. to skip re-importing), use
`organization { casts(isTemplate: true) { items { eid title } rowCount } }` — list
lightweight fields only and fetch `config` per-cast, since a Cast's `config` can be
large.
