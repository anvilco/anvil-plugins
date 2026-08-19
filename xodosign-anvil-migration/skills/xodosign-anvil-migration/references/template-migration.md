# Xodo Sign (eversign) Template Migration Reference

How to migrate Xodo Sign / eversign templates into Anvil. eversign templates are
**flat PDFs with positioned fields** (each field has a pixel `x`/`y`, a `page`, and
a `type`), plus optional **merge fields** for prefill. That maps directly onto an
Anvil PDF template (Cast), so the default path is **PDF + Document AI** — the same
approach the DropboxSign plugin uses. Content-heavy templates can optionally target
an Anvil **dynamic doc**.

---

## Overview

1. Inventory templates in Xodo Sign / eversign
2. Export each template as a PDF + metadata (the bundled script)
3. Choose a target per template:
   - **Target B — PDF + Document AI (default):** upload the exported PDF, let Anvil
     re-detect fields. Preserves the exact layout.
   - **Target A — dynamic doc (optional):** rebuild the template as a structured
     content tree. Only for content/reflow-based templates.
4. Map roles → signer IDs, fields/merge fields → aliases, and publish each Cast
5. Create an old → new ID mapping
6. Generate a database migration
7. Developer runs the migration

---

## The core structural fit

| eversign template | Anvil (PDF Cast — default) | Anvil (dynamic doc — optional) |
|-------------------|----------------------------|-------------------------------|
| Flat PDF | The same PDF, re-detected | Rebuilt as a content node tree |
| Positioned field (`x`/`y`/`page`, `type`) | Re-detected field box (Document AI) | Inline typed `field` node |
| Merge field (`{identifier, value}`) | Fill data on a field alias | Inline `field` node (fills by `aliasId`) |
| Signer role | Signer | Signer |
| Fixed layout | Frozen (preserved) | Reflowing content + real tables |

Because eversign already stores a flat PDF, the PDF path is a faithful, low-risk
migration. Dynamic docs are a *rebuild* — reach for them only when a template needs
reflowing text or repeating line-item tables.

---

## Two migration targets (tiered)

### Target B — PDF + Document AI (default, recommended)

Upload the exported PDF as an ordinary PDF Cast and let Anvil's Document AI detect
fields — the same approach as the DropboxSign plugin.

- Uses only the **stable public** `createCast` PDF path.
- **Preserves the exact layout** and field placement.
- Best for the straight migration of eversign's flat-PDF templates.

#### How

1. `scripts/export-xodosign-templates.ts` downloads each template's PDF (via
   `download_raw_document`) and writes a manifest with roles, recipients, and fields
   (types + `identifier` + coordinates).
2. Upload the PDFs with the `anvil-document-sdk` plugin's
   `scripts/migrate-pdfs-to-anvil.ts` (with `advancedDetectFields` for Document AI).
   Pass the field `identifier`s from the manifest as suggested aliases so detected
   fields carry your existing data keys.
3. Re-tag fields and assign signers in the Anvil template editor using the manifest.

### Target A — dynamic doc (optional, higher fidelity)

An Anvil **dynamic document** is a Cast whose content is a structured block/node
tree (headings, paragraphs, tables) with **inline field nodes**, authored via the
API. Consider it only when a template is content-heavy, needs reflow / real tables,
or should stay editable in Anvil.

**The honest tradeoff:** authoring a dynamic doc means generating Anvil's internal
content-tree JSON (a TipTap/ProseMirror node tree). That format is **not a public,
versioned contract** — pin your generator and re-verify after Anvil upgrades. It's
a higher-fidelity, higher-maintenance option.

#### How to author a dynamic doc (create → update → publish)

There is no content argument on `createCast`, so it's a three-step flow:

```typescript
import Anvil from '@anvilco/anvil'
const anvil = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

// 1. Create an EMPTY dynamic doc (the uploaded bytes are ignored; the mimetype
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

// 2. Set the real content tree. The config MUST have a "content" key.
const config = {
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Mutual NDA' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'This agreement is between ' },
      // A former eversign merge field (identifier "company_name") → an inline field node:
      { type: 'field', attrs: { id: 'f_company', type: 'shortText', name: 'Company Name', aliasId: 'company_name' } },
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
  Cast — a former merge field and a former positioned field are both just field
  nodes.
- **E-sign binding is identical to a PDF Cast:** a signer's `fields: [{ fileId, fieldId }]`
  references the field's `aliasId`. Signature, initial, and date types are
  first-class.
- **Limits:** no signatures inside repeating rows; conditional content is inline
  only; the content-tree format is internal/undocumented.

### Choosing (the tiered rule)

| Template characteristic | Target |
|-------------------------|--------|
| Flat PDF, fixed layout (the eversign default) | **B — PDF + Document AI** |
| Simple form with positioned fields | **B — PDF + Document AI** |
| Content-heavy, needs reflow / real tables / re-editable | **A — dynamic doc** |
| Repeating line-item / pricing tables (no signatures inside) | **A — dynamic doc** |
| Signatures embedded inside repeating rows | **B** (or restructure to move sigs out) |

The choice is per template. When unsure, default to **B** — it's the faithful
migration for eversign's flat PDFs. Ask the developer only when a template is
clearly content-driven.

---

## Step 1: Inventory + export

Use the bundled `scripts/export-xodosign-templates.ts`:

```bash
cp scripts/export-xodosign-templates.ts ./scripts/
npx ts-node scripts/export-xodosign-templates.ts --output-dir ./migrated-templates
```

It lists your templates (`GET /document?type=templates`), downloads each as a PDF,
and captures roles, recipients (CC), and fields (types + `identifier` + coordinates)
into `xodosign-template-manifest.json`. Review it with the developer.

```bash
# Specific templates only
npx ts-node scripts/export-xodosign-templates.ts \
  --output-dir ./migrated-templates --template-ids "hash1,hash2"

# Dry run — list without downloading
npx ts-node scripts/export-xodosign-templates.ts \
  --output-dir ./migrated-templates --dry-run
```

Ask the developer: **"Do you want to migrate all templates, or just specific ones?
If some are deprecated, we can skip them."**

---

## Step 2: Import per target

- **Target B (default):** upload the exported PDFs with the `anvil-document-sdk`
  plugin's `scripts/migrate-pdfs-to-anvil.ts` (Document AI). Pass the manifest's
  field `identifier`s as suggested aliases.
- **Target A (optional):** build the content tree from the manifest (fields/merge
  fields → field nodes by `aliasId`, roles → signer assignments) and run create →
  `updateCast` → `publishCast` (above).

Both write/collect the new `castEid` per template.

---

## Step 3: Map roles, fields, merge fields

| eversign | Anvil |
|----------|-------|
| Signer role (`role`) | Signer id (e.g. `Client` → `client`) |
| Positioned field (`identifier`, `signer`) | Field alias, assigned to that signer |
| Merge field (`{identifier, value}`) | Fill-data key (not a signer field) |
| `order` | `routingOrder` |

In the Anvil template editor, confirm each signature/initials/date field is assigned
to the correct signer, and that field aliases match your data model.

---

## Step 4: Create the ID mapping

Combine the manifest with the new `castEid`s into `template-id-mapping.json`
(eversign `template_id` / `document_hash` → Anvil `castEid`):

```json
{
  "mappings": [
    {
      "eversignTemplateId": "tmpl_abc123",
      "eversignDocumentHash": "9a8b7c...",
      "eversignTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "roleMappings": { "Client": "client", "Manager": "manager" },
      "fieldMappings": { "company_name": "company_name", "effective_date": "effectiveDate" }
    }
  ]
}
```

---

## Step 5: Generate a database migration

Detect the developer's migration framework and generate a migration that:
- Adds Anvil EID columns (`cast_eid`, `etch_packet_eid`) **alongside** the existing
  eversign columns (`eversign_template_id`, `document_hash`).
- Populates `cast_eid` from `template-id-mapping.json`.
- Leaves the eversign columns intact (removed after verification).

Detection strategy (same as the other migration plugins):
- `prisma/schema.prisma` → Prisma migration
- `knexfile.{js,ts}` → Knex migration
- Sequelize-style `migrations/*` with `queryInterface` → Sequelize migration
- TypeORM `data-source.ts` → TypeORM migration
- None detected → raw SQL

```sql
-- Raw SQL example
ALTER TABLE signing_requests ADD COLUMN cast_eid VARCHAR(255);
ALTER TABLE signing_requests ADD COLUMN etch_packet_eid VARCHAR(255);
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE eversign_template_id = 'tmpl_abc123';
-- ... one UPDATE per mapping entry
```

**The developer runs the migration** — do not run it automatically. Tell them:
**"I've generated the migration at [path]. It adds Anvil EID columns alongside your
eversign columns and populates them from the template ID mapping. Please review and
run it when you're ready."**

---

## Step 6: Publish + verify

For each imported Cast:

1. Open it at `https://app.useanvil.com`.
2. Review field tagging and aliases — confirm they match your data model.
3. Confirm each field's signer assignment.
4. Click **Publish** — unpublished templates return an error from `fillPDF` /
   `createEtchPacket`.

Verify with `cast(eid) { config }` (see `api-mapping.md` → "Listing & Reading Anvil
Templates") and a test `fillPDF`. Confirm fields fill and signers bind before moving
to code migration.
