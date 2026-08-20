# signNow Template Migration Reference

How to migrate signNow templates into Anvil. signNow templates are **flat PDFs with
positioned fields** (each field carries `x`/`y`/`page_number`/`width`/`height` and a
`role`). That makes the **PDF + Anvil Document AI** path the natural default — the
same approach the DropboxSign plugin uses. For content-heavy templates that would
benefit from reflowing text or repeating tables, an optional **dynamic-doc** target
is available.

---

## Overview

1. Inventory templates in signNow
2. Choose a target per template:
   - **Target A — PDF + Document AI (default):** download the template's PDF, upload
     to Anvil, let Document AI detect fields, then re-tag.
   - **Target B — Dynamic doc (optional, higher fidelity):** rebuild the template as
     a structured content tree with inline field nodes — only for content-based
     templates.
3. Map roles → signer IDs, fields → aliases, prefill → data keys
4. Create an old → new ID mapping
5. Generate a database migration
6. Developer runs the migration
7. Publish + verify each Anvil template

---

## Choosing a target (the tiered rule)

| Template characteristic | Target |
|-------------------------|--------|
| Fixed-layout PDF with positioned fields (the common case) | **A — PDF + Document AI** |
| PDF-origin, simple layout, or you want the least-maintenance path | **A — PDF + Document AI** |
| Content-heavy, needs reflow / real tables / re-editable in Anvil | **B — dynamic doc** |
| Repeating line-item / pricing tables (no signatures inside) | **B — dynamic doc** |
| Signatures embedded inside repeating rows | **A** (or restructure to move sigs out) |

signNow templates are flat PDFs, so **Target A is the default** — it preserves the
exact layout and field placement. Target B is a *rebuild*, worth it only when a
template's value is its structure (reflowing clauses, line-item tables). The choice
is **per template**; when unsure, ask the developer which matters more for a given
template: speed/simplicity (A) or structural fidelity/editability (B).

---

## Step 1: Inventory templates

Templates in signNow live in the account's **Templates** folder. The bundled
`scripts/export-signnow-templates.ts` enumerates them for you:

```bash
# List without downloading
npx ts-node scripts/export-signnow-templates.ts --output-dir ./migrated-templates --dry-run
```

Under the hood it finds the Templates folder (`GET /user/folders`), lists its
documents (`GET /folder/{id}`), and reads each template's roles + fields
(`GET /document/{id}`). For each template note: template ID, name, roles, and fields
(signature/text/checkbox/… with their coordinates).

Ask the developer: **"Do you want to migrate all templates, or just specific ones?
If some are deprecated, we can skip them."**

---

## Step 2 (Target A): Export template PDFs + metadata

Use the bundled `scripts/export-signnow-templates.ts`. It:

1. Exchanges a Basic client credential for a Bearer token (or uses a token you
   provide), then lists templates from the Templates folder.
2. For each template, reads its roles/fields (`GET /document/{id}`) and downloads
   its flattened PDF (`GET /document/{id}/download?type=collapsed`).
3. Writes one `<title>.pdf` per template plus a `signnow-template-manifest.json`
   with metadata (template ID, title, roles, fields with types/coordinates).

```bash
# All templates
npx ts-node scripts/export-signnow-templates.ts --output-dir ./migrated-templates

# Specific templates
npx ts-node scripts/export-signnow-templates.ts \
  --output-dir ./migrated-templates \
  --template-ids "abc123,def456"
```

The manifest looks like:

```json
{
  "exportedAt": "2026-08-19T...",
  "templates": [
    {
      "templateId": "abc123...",
      "title": "NDA Template",
      "pdfFilename": "NDA_Template.pdf",
      "roles": [
        { "name": "Signer 1", "signingOrder": 1 },
        { "name": "Signer 2", "signingOrder": 2 }
      ],
      "fields": [
        { "name": "CompanyName", "type": "text", "role": "Signer 1", "pageNumber": 0, "x": 153, "y": 230, "width": 84, "height": 11 },
        { "name": "Signature",   "type": "signature", "role": "Signer 1", "pageNumber": 2, "x": 191, "y": 148, "width": 120, "height": 30 }
      ],
      "status": "success"
    }
  ]
}
```

---

## Step 3 (Target A): Upload PDFs to Anvil

Use the `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts` to upload
the exported PDFs, optionally seeding field aliases from your data schema:

```bash
# With field alias suggestions from your schema
npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates --schema ./extracted-schema.json

# Without schema
npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates
```

Pass `advancedDetectFields` (Document AI) to auto-detect field rectangles — it
requires the Document AI entitlement. This writes `anvil-migration-manifest.json`
with each new `castEid`.

Then open each template in the Anvil dashboard to review field tagging, assign
signature fields to signer IDs, and confirm aliases — the manifest's field
coordinates/types tell you what to expect and where.

---

## Step 2–3 (Target B): Dynamic doc (optional, content-based templates only)

An Anvil **dynamic document** is a Cast whose content is a structured block/node
tree (headings, paragraphs, lists, tables) with **inline field nodes**, authored via
the API rather than uploaded as a PDF. Use it only for templates whose value is
their structure. There is no content argument on `createCast`, so it's a three-step
flow — create → update → publish:

```typescript
import Anvil from '@anvilco/anvil'
const anvil = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

// 1. Create an EMPTY dynamic doc (the mimetype selects the dynamic-document type;
//    the uploaded bytes are ignored).
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
      // A former signNow text field → an inline field node (fills by aliasId):
      { type: 'field', attrs: { id: 'f_company', type: 'shortText', name: 'Company Name', aliasId: 'companyName' } },
      { type: 'text', text: ' and Acme Inc.' },
    ] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Signature: ' },
      { type: 'field', attrs: { id: 'f_sig', type: 'signature', name: 'Signer 1 Signature', aliasId: 'signer1Signature' } },
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
  Cast — a former signNow field and a former prefill value are both just field
  nodes / data keys.
- **E-sign binding is identical to a PDF Cast:** in `createEtchPacket`, a signer's
  `fields: [{ fileId, fieldId }]` references the field's `aliasId`. Signature,
  initial, and date field types are first-class in dynamic docs.
- **Repeating rows** bind to an array data key (e.g. `data.lineItems = [{…}, {…}]`).
- For large configs, ship the tree as a `configFile` (Upload) instead of the inline
  `config` JSON to avoid request-size limits.

**Dynamic-doc limitations (design around these):**
- **No signatures/interactive fields inside a repeating row** — keep signature
  fields outside repeats.
- **Conditional content is inline-text only** (a `clause` mark), not whole
  block/section or per-row.
- **The content-tree format is Anvil-internal / undocumented** — pin your generator
  to the fields you actually use and re-verify after Anvil upgrades.

---

## Step 4: Map roles, fields, prefill

| signNow | Anvil |
|---------|-------|
| Role (`Signer 1`) | Signer id (e.g. `signer1`) |
| Field (`signature`/`text`/…), `role` | Field alias, assigned to that signer |
| Prefill (`field_name`) | Fill-data key (`data.payloads`) |
| invite `order` | `routingOrder` |

| signNow role | Anvil signer ID | Signing order |
|--------------|-----------------|---------------|
| `Signer 1` | `signer1` | 1 |
| `Signer 2` | `signer2` | 2 |

In the Anvil template editor, confirm each signature/date/initial field is assigned
to the correct signer, and that field aliases match your data model.

---

## Step 5: Create the ID mapping

Combine the signNow manifest and the Anvil manifest into `template-id-mapping.json`
(signNow templateId → Anvil `castEid`):

```json
{
  "mappings": [
    {
      "signnowTemplateId": "abc123...",
      "signnowTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "roleMappings": { "Signer 1": "signer1", "Signer 2": "signer2" },
      "fieldMappings": { "CompanyName": "companyName", "EffectiveDate": "effectiveDate" }
    }
  ]
}
```

Save it in the project root — it drives the database migration and the code updates.

---

## Step 6: Generate a database migration

Detect the developer's migration framework and generate a migration that:
- Adds Anvil EID columns (`cast_eid`, `etch_packet_eid`) **alongside** the existing
  signNow columns (`signnow_template_id`, `signnow_document_id`).
- Populates `cast_eid` from `template-id-mapping.json`.
- Leaves the signNow columns intact (removed after verification).

Detection strategy (same as the DropboxSign plugin):
- `prisma/schema.prisma` → Prisma migration
- `knexfile.{js,ts}` → Knex migration
- Sequelize-style `migrations/*` with `queryInterface` → Sequelize migration
- TypeORM `data-source.ts` → TypeORM migration
- None detected → raw SQL

```sql
-- Raw SQL example
ALTER TABLE signing_requests ADD COLUMN cast_eid VARCHAR(255);
ALTER TABLE signing_requests ADD COLUMN etch_packet_eid VARCHAR(255);
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE signnow_template_id = 'abc123...';
```

**The developer runs the migration** — do not run it automatically. Tell them:
**"I've generated the migration at [path]. It adds Anvil EID columns alongside your
signNow columns and populates them from the template ID mapping. Please review and
run it when you're ready."**

---

## Step 7: Publish + verify

For each migrated Cast:

1. Open it at `https://app.useanvil.com`.
2. Review field tagging and aliases — confirm they match your data model.
3. Confirm each field's signer assignment.
4. Click **Publish** — unpublished templates return an error from `fillPDF` /
   `createEtchPacket`.

Verify programmatically with `cast(eid) { config }` (see `api-mapping.md` →
"Listing & Reading Anvil Templates") and a test `fillPDF` before moving to code
migration. To list what's already in the org (e.g. to skip re-importing), use
`organization { casts(isTemplate: true) { items { eid title } rowCount } }` — list
lightweight fields only and fetch `config` per-cast.
