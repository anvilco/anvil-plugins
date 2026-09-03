# PandaDoc Template Migration Reference

Migrating PandaDoc templates into Anvil. Unlike DocuSign (which exposes a flat PDF
per document and converts losslessly), **PandaDoc templates are block/content-based**
— a tree of rich-text blocks, merge **tokens**, and **fields** assigned to roles.
There is no flat-PDF export for a template. That shapes the whole strategy.

This reference gives you **two migration targets** and a tiered rule for choosing
between them.

---

## The core structural difference

| PandaDoc template | Anvil (PDF Cast) | Anvil (dynamic doc) |
|-------------------|------------------|---------------------|
| Rich-text blocks | Frozen into a static PDF | Rich-text `content` node tree (preserved) |
| `{{tokens}}` (merge vars) | Fill data on a positioned field | Inline `field` node (fills by `aliasId`) |
| Fields (widgets) | Positioned rectangles (re-detected) | Inline typed `field` nodes |
| Roles | Signers | Signers |
| Pricing / line-item tables | Flattened | Repeating table rows |

A PandaDoc token is a **body merge variable**, not a widget — in Anvil it becomes
**fill data**, not a signer field.

---

## Two migration targets (tiered)

### Target A — Dynamic doc (higher fidelity)

An Anvil **dynamic document** is a Cast whose content is a structured block/node
tree (headings, paragraphs, lists, tables, images) with **inline field nodes**,
authored via the API rather than uploaded as a PDF. It maps onto PandaDoc's model
far more naturally than a flattened PDF:

| PandaDoc | Dynamic doc |
|----------|-------------|
| Rich-text blocks | `content` nodes (`paragraph`, `heading`, `bulletList`, `image`, `table`) |
| `{{token}}` | inline `field` node with `aliasId` = the token name |
| Field (signature/text/date/…) | typed `field` node (`signature`, `shortText`, `date`, …) |
| Pricing / line items | a `table` row marked `repeatingRow` bound to an array data key |
| Conditional text | a `clause` mark on inline text |

**Why it's higher fidelity:** it preserves *semantic structure* — real headings,
reflowing text, tables, and re-editable content — instead of freezing pixels and
re-detecting field rectangles.

**The honest tradeoff:** authoring a dynamic doc means generating Anvil's internal
content-tree JSON (a TipTap/ProseMirror node tree). That format is **not a public,
versioned contract** — it can drift, and there's no "create a structured template
in one call" endpoint. Treat Target A as a **higher-fidelity, higher-maintenance**
option, best when templates are content-heavy or must stay editable in Anvil.

#### How to author a dynamic doc (create → update → publish)

There is no content argument on `createCast`, so it's a three-step flow:

```typescript
import Anvil from '@anvilco/anvil'
const anvil = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

// 1. Create an EMPTY dynamic doc (the uploaded bytes are ignored; the mimetype
//    is what selects the dynamic-document type).
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
      // A former {{Client.CompanyName}} token → an inline field node:
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
  Cast — a former token and a former field are both just field nodes.
- **E-sign binding is identical to a PDF Cast:** in `createEtchPacket`, a signer's
  `fields: [{ fileId, fieldId }]` references the field's `aliasId`. Signature,
  initial, and date field types are first-class in dynamic docs.
- **Repeating rows** bind to an array data key (e.g. `data.lineItems = [{…}, {…}]`).
- For large configs, ship the tree as a `configFile` (Upload) instead of the inline
  `config` JSON to avoid request-size limits.

#### Dynamic-doc limitations (design around these)

- **No signatures/interactive fields inside a repeating row** — put signature
  fields outside repeats.
- **Conditional content is inline-text only** (a `clause` mark), not whole
  block/section or per-row — PandaDoc block-level conditionals map only partially.
- **The content-tree format is internal/undocumented** — pin your generator to the
  fields you actually use and re-verify after Anvil upgrades.

### Target B — PDF + Document AI (simpler, stable)

Render a base PDF from the template and upload it as an ordinary PDF Cast, letting
Anvil's Document AI detect fields — the same approach as the DropboxSign plugin.

- Uses only the **stable public** `createCast` PDF path.
- **Freezes layout** (no reflow, not re-editable as structured content).
- Best for PDF-origin templates, simple/fixed layouts, or when you want the fastest
  path with the least maintenance.

#### How

1. `scripts/export-pandadoc-templates.ts` already renders a base PDF per template
   (by instantiating a throwaway document and downloading it) and writes a manifest
   with roles, fields, and tokens.
2. Upload the PDFs with the `anvil-document-sdk` plugin's
   `scripts/migrate-pdfs-to-anvil.ts` (with `advancedDetectFields` for Document AI).
3. Re-tag fields and assign signers in the Anvil template editor using the manifest.

### Choosing (the tiered rule)

| Template characteristic | Target |
|-------------------------|--------|
| Content-heavy, needs reflow / real tables / re-editable | **A — dynamic doc** |
| Repeating line-item / pricing tables (no signatures inside) | **A — dynamic doc** |
| Simple/fixed layout, PDF-origin, or you want the least-maintenance path | **B — PDF + Document AI** |
| Signatures embedded inside repeating rows | **B** (or restructure to move sigs out) |

You can migrate different templates via different targets — the choice is per
template. When unsure, ask the developer which matters more for a given template:
structural fidelity/editability (A) or speed/simplicity (B).

---

## Step 1: Inventory + export

Use the bundled `scripts/export-pandadoc-templates.ts`:

```bash
cp scripts/export-pandadoc-templates.ts ./scripts/
npx ts-node scripts/export-pandadoc-templates.ts --output-dir ./migrated-templates
```

It reads each template's details (roles, fields, tokens), renders a base PDF, and
captures field geometry where available (for Target B), writing
`pandadoc-template-manifest.json`. Review it with the developer and decide a target
per template.

> The export instantiates a throwaway document per template to render its PDF (it's
> never sent, and is deleted afterward unless `--keep-docs`). Use a **sandbox key**
> to avoid touching production.

## Step 2: Import per target

- **Target A (dynamic doc):** build the content tree from the manifest (blocks →
  content nodes, tokens/fields → field nodes by `aliasId`, roles → signer
  assignments) and run create → update → publish (above).
- **Target B (PDF + Document AI):** upload the base PDFs with
  `migrate-pdfs-to-anvil.ts`, then re-tag.

## Step 3: Map roles, fields, tokens

| PandaDoc | Anvil |
|----------|-------|
| Role name (`roles[].name`) | Signer id (e.g. `Client` → `client`) |
| Field (`fields[]`, `assigned_to.role`) | Field alias, assigned to that signer |
| Token (`tokens[].name`) | Fill-data key (not a signer field) |
| `signing_order` | `routingOrder` |

## Step 4: ID mapping + database migration

Combine the manifest with the new `castEid`s into `template-id-mapping.json`
(PandaDoc `template_uuid` → Anvil `castEid`). Then generate a DB migration that adds
Anvil EID columns (`cast_eid`, `etch_packet_eid`) alongside the existing PandaDoc
columns and populates them from the mapping. **Detect the developer's migration
framework** (Prisma / Knex / Sequelize / TypeORM / raw SQL) and match it.

**The developer runs the migration** — do not run it automatically.

## Step 5: Publish + verify

Publish each template. Verify with `cast(eid) { config }` (see `api-mapping.md` →
"Listing & Reading Anvil Templates") and a test `fillPDF`. Confirm fields fill and
signers bind before moving to code migration.
