# Adobe Acrobat Sign Template Migration Reference

How to migrate Adobe Sign **library documents** into Anvil. Adobe library documents
are **flat PDFs with positioned form fields** — the same shape the DropboxSign
plugin handles — so the default path is **PDF + Anvil Document AI**. For
content-heavy or reflowing agreements, Anvil **dynamic docs** are an optional
higher-fidelity target. You choose per template.

> Unlike DocuSign, Adobe Sign has **no lossless JSON-to-template converter**. Fields
> are re-detected from the PDF by Anvil's Document AI, then re-tagged — the export
> manifest tells you what to expect.

---

## Overview

1. Inventory library documents in Adobe Sign
2. Export each as a PDF + metadata (the bundled script)
3. Choose a target per template (rule below)
4. Import: upload the PDF (Document AI) **or** build a dynamic doc
5. Map roles → signer IDs, fields → aliases, merge fields → data
6. Create an old → new ID mapping
7. Generate a database migration
8. Developer runs the migration; publish + verify each template

---

## The two migration targets (tiered)

### Target B — PDF + Document AI (default)

Upload the exported library-document PDF as an ordinary PDF Cast and let Anvil's
Document AI detect the fields — then re-tag against the manifest.

- Uses only the **stable public** `createCast` PDF path.
- **Preserves the exact layout** — the natural fit for Adobe's fixed-PDF library
  documents.
- Fastest, least-maintenance path.

#### How

1. `scripts/export-adobesign-templates.ts` downloads each library document's
   combined PDF and writes a manifest (participants/roles, form fields, sharing
   mode).
2. Upload the PDFs with the `anvil-document-sdk` plugin's
   `scripts/migrate-pdfs-to-anvil.ts` (with `advancedDetectFields` for Document AI).
3. Re-tag fields and assign signers in the Anvil template editor using the manifest.

### Target A — Dynamic doc (higher fidelity, optional)

An Anvil **dynamic document** is a Cast whose content is a structured block/node
tree (headings, paragraphs, lists, tables) with **inline field nodes**, authored via
the API rather than uploaded as a PDF.

| Adobe agreement content | Dynamic doc |
|-------------------------|-------------|
| Rich text / reflowing body | `content` nodes (`paragraph`, `heading`, `bulletList`, `table`) |
| Merge field | inline `field` node with `aliasId` = the field name |
| Form field (signature/text/date/…) | typed `field` node (`signature`, `shortText`, `date`, …) |
| Repeating line items | a `table` row marked `repeatingRow` bound to an array data key |

**Why it's higher fidelity:** it preserves *semantic structure* — real headings,
reflowing text, tables, re-editable content — instead of freezing pixels and
re-detecting rectangles.

**The honest tradeoff:** authoring a dynamic doc means generating Anvil's internal
content-tree JSON (a TipTap/ProseMirror node tree). That format is **not a public,
versioned contract** — pin your generator and re-verify after Anvil upgrades. Treat
Target A as **higher-fidelity, higher-maintenance**.

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
  variables: { file: emptyFile, title: 'MSA' },
})
const castEid = created?.data?.createCast?.eid

// 2. Set the real content tree. The config MUST have a "content" key.
const config = {
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Master Services Agreement' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'This agreement is between ' },
      // A former Adobe merge field → an inline field node:
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
  Cast — a former merge field and a former form field are both just field nodes.
- **E-sign binding is identical to a PDF Cast:** in `createEtchPacket`, a signer's
  `fields: [{ fileId, fieldId }]` references the field's `aliasId`.
- **Repeating rows** bind to an array data key. **No signatures inside a repeating
  row** — keep signature fields outside repeats.
- For large configs, ship the tree as a `configFile` (Upload) instead of inline
  `config` JSON to avoid request-size limits.

### Choosing (the tiered rule)

| Template characteristic | Target |
|-------------------------|--------|
| Fixed-layout PDF library document (the common case) | **B — PDF + Document AI** |
| Simple form, PDF-origin, least-maintenance path | **B — PDF + Document AI** |
| Content-heavy, reflowing text, real tables, re-editable in Anvil | **A — dynamic doc** |
| Repeating line-item tables (no signatures inside) | **A — dynamic doc** |

Different templates can use different targets — the choice is per template. When
unsure, default to **B** (it matches Adobe's fixed-PDF model); reach for **A** only
when structural fidelity or editability clearly matters.

---

## Step 1: Inventory library documents

List library documents from Adobe Sign to understand what needs to migrate.

```bash
curl -H "Authorization: Bearer $ADOBE_SIGN_ACCESS_TOKEN" \
  "$ADOBE_SIGN_BASE_URI/api/rest/v6/libraryDocuments"
```

The bundled `scripts/export-adobesign-templates.ts` does this for you. For each
library document, note: `libraryDocumentId`, name, participant roles, and form
fields.

Ask the developer: **"Do you want to migrate all library documents, or just specific
ones? If some are deprecated, we can skip them."**

---

## Step 2: Export library documents as PDF + metadata

Use the bundled `scripts/export-adobesign-templates.ts`. It:

1. Resolves the account's API base URI (`GET /baseUris` → `apiAccessPoint`, or
   `--base-uri`).
2. Lists library documents (`GET /libraryDocuments`, paginated).
3. For each, downloads the combined PDF
   (`GET /libraryDocuments/{id}/combinedDocument`) and captures its form-field and
   participant metadata.
4. Writes one `<name>.pdf` per template plus `adobesign-template-manifest.json`
   (id, title, roles, fields, sharing mode).

```bash
# All library documents
npx ts-node scripts/export-adobesign-templates.ts --output-dir ./migrated-templates

# Specific ones
npx ts-node scripts/export-adobesign-templates.ts \
  --output-dir ./migrated-templates \
  --template-ids "CBJCHBCAABAA1,CBJCHBCAABAA2"

# Dry run — list without downloading
npx ts-node scripts/export-adobesign-templates.ts \
  --output-dir ./migrated-templates --dry-run
```

Review the manifest with the developer and decide a target per template.

---

## Step 3: Import per target

- **Target B (PDF + Document AI):** upload the exported PDFs with the
  `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts` (with
  `advancedDetectFields`), then re-tag fields.
- **Target A (dynamic doc):** build the content tree from the manifest (body →
  content nodes, merge/form fields → field nodes by `aliasId`, roles → signer
  assignments) and run create → `updateCast` → `publishCast` (above).

---

## Step 4: Map roles → signer IDs, fields → aliases, merge fields → data

The Adobe participant roles become Anvil signer IDs. Record the mapping so your
`createEtchPacket` code uses the right signer IDs and routing:

| Adobe role | Anvil signer ID | Routing order (`order`) |
|------------|-----------------|-------------------------|
| `SIGNER` | `signer` | 1 |
| `APPROVER` | `approver` | 2 |

| Adobe field name | Anvil field alias | Notes |
|------------------|-------------------|-------|
| `CompanyName` | `companyName` | camelCase if desired |
| `EffectiveDate` | `effectiveDate` | |

Adobe `mergeFieldInfo` values become `data.payloads.{fileId}.data` keyed by the alias.
In the Anvil template editor, confirm each signature/date/initial field is assigned
to the correct signer.

---

## Step 5: Publish templates

For each imported Cast:

1. Open it at `https://app.useanvil.com`.
2. Review field tagging and aliases — confirm they match your data model.
3. Confirm each field's signer assignment.
4. Click **Publish** — unpublished templates return an error from `fillPDF` /
   `createEtchPacket`.

---

## Step 6: Create the ID mapping

Combine the export manifest and the new `castEid`s into `template-id-mapping.json`:

```json
{
  "mappings": [
    {
      "adobeSignLibraryDocumentId": "CBJCHBCAABAA...",
      "adobeSignTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "target": "pdf",
      "roleMappings": { "SIGNER": "signer", "APPROVER": "approver" },
      "fieldMappings": { "CompanyName": "companyName", "EffectiveDate": "effectiveDate" }
    }
  ]
}
```

---

## Step 7: Generate a database migration

Detect the developer's migration framework and generate a migration that:
- Adds Anvil EID columns (`cast_eid`, `etch_packet_eid`) **alongside** the existing
  Adobe Sign columns (`library_document_id`, `agreement_id`).
- Populates `cast_eid` from `template-id-mapping.json`.
- Leaves the Adobe Sign columns intact (removed after verification).

Detection strategy:
- `prisma/schema.prisma` → Prisma migration
- `knexfile.{js,ts}` → Knex migration
- Sequelize-style `migrations/*` with `queryInterface` → Sequelize migration
- TypeORM `data-source.ts` → TypeORM migration
- None detected → raw SQL

```sql
-- Raw SQL example
ALTER TABLE signing_requests ADD COLUMN cast_eid VARCHAR(255);
ALTER TABLE signing_requests ADD COLUMN etch_packet_eid VARCHAR(255);
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE library_document_id = 'CBJCHBCAABAA...';
```

**The developer runs the migration** — do not run it automatically. Tell them:
**"I've generated the migration at [path]. It adds Anvil EID columns alongside your
Adobe Sign columns and populates them from the template ID mapping. Please review and
run it when you're ready."**

---

## Step 8: Verify

Verify a converted template with `cast(eid) { config }` (see `api-mapping.md` →
"Listing & Reading Anvil Templates") and a test `fillPDF`. Confirm fields fill and
signers bind before moving to code migration.
