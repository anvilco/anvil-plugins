# DocuSign Template Migration Reference

How to migrate DocuSign templates into Anvil. DocuSign has a capability the other
providers don't: **Anvil can convert a DocuSign template/envelope definition
directly into an Anvil template (Cast), preserving field geometry, field types,
and signer roles.** This reference covers that converter (Path A) and a PDF
fallback (Path B).

---

## Overview

1. Inventory templates in DocuSign
2. Choose a path per template:
   - **Path A — JSON converter (recommended):** export the template as
     converter-shaped JSON, upload to Anvil; fields + coordinates + roles are
     reconstructed automatically.
   - **Path B — PDF + Document AI (fallback):** download the template PDF, upload
     to Anvil, let Document AI re-detect fields.
3. Review, map roles → signer IDs, and publish each Anvil template
4. Create an old → new ID mapping
5. Generate a database migration
6. Developer runs the migration

---

## How the converter works

Anvil's `createCast` API accepts an uploaded **file**. When that file is
`application/json` in a DocuSign template/envelope shape, Anvil runs its
DocuSign JSON parser instead of PDF field-detection, and builds the Cast from the
JSON: each document's bytes become the Cast's PDF, each recipient tab becomes a
field (with its rectangle and type), and each signer role becomes a signer slot.

```
DocuSign template  ─►  export JSON  ─►  createCast (application/json)  ─►  Anvil Cast
(recipients+tabs+docs)  (tabs + base64)      (JSON parser runs)           (castEid, fields, signers)
```

### What the converter expects (JSON shape)

The uploaded JSON must have `recipients` (an object) and `documents` (a non-empty
array), with each document carrying its bytes as **inline base64**:

```json
{
  "emailSubject": "Please sign the NDA",
  "emailBlurb": "Thanks for partnering with us.",
  "recipients": {
    "signers": [
      {
        "recipientId": "1",
        "roleName": "Signer",
        "routingOrder": "1",
        "tabs": {
          "signHereTabs": [
            { "documentId": "1", "pageNumber": "3", "xPosition": "191", "yPosition": "148",
              "tabId": "abc-...", "tabLabel": "Signature", "required": "true" }
          ],
          "textTabs": [
            { "documentId": "1", "pageNumber": "1", "xPosition": "153", "yPosition": "230",
              "width": "84", "height": "11", "tabId": "def-...", "tabLabel": "CompanyName" }
          ]
        }
      }
    ],
    "carbonCopies": []
  },
  "documents": [
    { "documentId": "1", "name": "NDA", "documentBase64": "JVBERi0xLjYK..." }
  ]
}
```

### What the converter preserves

- **Field geometry** — `xPosition/yPosition/width/height` (top-left, points) are
  converted to Anvil's page rectangles, per page (`pageNumber` is 1-based in
  DocuSign; the converter handles the offset).
- **Field types** — mapped from the tab type (see the table below).
- **Signer roles** — `recipients.signers[].roleName` becomes an Anvil signer slot,
  keyed by a camelCased role name, carrying `routingOrder`.
- **Stable field IDs** — each tab's `tabId` becomes the Anvil field's alias
  (`aliasId`), so your existing data keys survive.
- **Radio groups & dropdowns** — radio `radios[]` and list `listItems[]` options
  are carried over as child options / dropdown values.

### Tab type → Anvil field type

| DocuSign tab | Anvil field type |
|--------------|------------------|
| `signHere` / `signHereOptional` | `signature` |
| `initialHere` / `initialHereOptional` | `initial` |
| `dateSigned` | `signatureDate` |
| `fullName` | `fullName` |
| `text` / `zip` / `list` | `shortText` (list also carries dropdown values) |
| `number` | `number` |
| `email` / `emailAddress` | `email` |
| `ssn` | `shortText` with `ssn` format |
| `checkbox` | `checkbox` |
| `radioGroup` | `radioGroup` (with child checkbox options) |
| `note`, `approve`, `decline`, `draw`, `signerAttachmentOptional` | dropped |

### What the converter does NOT carry over

- **Non-signer recipients** — `carbonCopies`, `agents`, `editors`,
  `certifiedDeliveries` are ignored. Re-add them at packet-creation time (see
  `feature-parity.md`).
- **Unsupported tab types** — the tabs marked "dropped" above.
- **Notifications** — reminders and expirations (handle app-level).

---

## Step 1: Inventory templates

List templates from DocuSign to understand what needs to migrate.

```bash
curl -H "Authorization: Bearer $DOCUSIGN_ACCESS_TOKEN" \
  "$DOCUSIGN_BASE_URI/restapi/v2.1/accounts/$DOCUSIGN_ACCOUNT_ID/templates"
```

The bundled `scripts/export-docusign-templates.ts` does this for you. For each
template, note: template ID, name, roles, and tabs (merge/signature fields).

Ask the developer: **"Do you want to migrate all templates, or just specific ones?
If some are deprecated, we can skip them."**

---

## Step 2 (Path A): Export templates as converter JSON

Use the bundled `scripts/export-docusign-templates.ts`. It:

1. Authenticates to DocuSign (JWT or an existing access token) and discovers the
   `accountId` + `base_uri` from `/oauth/userinfo`.
2. Lists templates (or the specific IDs you pass).
3. For each template, fetches the recipients + tabs
   (`GET /templates/{id}?include=recipients`) and each document's bytes
   (`GET /templates/{id}/documents/{documentId}`), base64-encoding them inline.
4. Writes one converter-shaped `<template>.json` per template plus a
   `docusign-template-manifest.json` with metadata (template ID, title, roles,
   fields).

```bash
# All templates
npx ts-node scripts/export-docusign-templates.ts --output-dir ./migrated-templates

# Specific templates
npx ts-node scripts/export-docusign-templates.ts \
  --output-dir ./migrated-templates \
  --template-ids "adbc1234,ef567890"

# Dry run — list without downloading
npx ts-node scripts/export-docusign-templates.ts \
  --output-dir ./migrated-templates --dry-run
```

---

## Step 3 (Path A): Upload the JSON to Anvil

Use the bundled `scripts/import-docusign-json.ts`. It uploads each converter JSON
to `createCast` as an `application/json` file (via the Anvil client's
`prepareGraphQLFile`), and writes an `anvil-import-manifest.json` with each new
`castEid`.

```bash
npx ts-node scripts/import-docusign-json.ts --dir ./migrated-templates
```

The core call each script makes:

```typescript
import Anvil from '@anvilco/anvil'
const anvil = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

const file = Anvil.prepareGraphQLFile(jsonBuffer, {
  filename: 'NDA.json',
  mimetype: 'application/json',
})

const { data } = await anvil.requestGraphQL({
  query: `mutation CreateCast($organizationEid: String, $title: String, $file: Upload!) {
    createCast(organizationEid: $organizationEid, title: $title, file: $file, isTemplate: true) {
      eid
      title
      config
    }
  }`,
  variables: { organizationEid, title: 'NDA', file },
})
const castEid = data?.data?.createCast?.eid
```

**Notes:**
- This path needs only an authenticated Anvil API key with write access — it is
  **not** gated behind Document AI or any add-on entitlement.
- `detectFields` is irrelevant here: the parser builds the fields from the JSON,
  not from PDF detection.
- The created Cast is a **draft** — it must be published (Step 5) before it can be
  used in `createEtchPacket`.

**Verify the conversion.** Fetch the new Cast's fields to confirm the converter
produced what you expect (field count, types, aliases):

```graphql
query GetTemplate($eid: String!) {
  cast(eid: $eid) { eid title config }
}
```

To list everything already in the org (e.g. to skip re-importing), use
`organization { casts(isTemplate: true) { items { eid title } rowCount } }` — list
lightweight fields only and fetch `config` per-cast, since a Cast's `config` can
be large. See `api-mapping.md` → "Listing & Reading Anvil Templates".

---

## Step 2–3 (Path B): PDF + Document AI fallback

When a template can't be converted from JSON (e.g. tabs the converter drops that
you still need, or you'd rather re-detect), fall back to the PDF path — the same
one the DropboxSign plugin uses:

1. Download the template's document PDF from DocuSign
   (`GET /templates/{id}/documents/{documentId}`).
2. Upload it with the `anvil-document-sdk` plugin's
   `scripts/migrate-pdfs-to-anvil.ts` (optionally with `advancedDetectFields` for
   Document AI field detection).
3. Tag/adjust fields in the Anvil template editor.

`export-docusign-templates.ts` can also save the raw PDFs (`--include-pdf`) so you
have both representations to choose from.

---

## Step 4: Map roles → signer IDs

The converter keys signers by camelCased role name. Record the mapping so your
`createEtchPacket` code uses the right signer IDs:

| DocuSign role | Anvil signer ID | Routing order |
|---------------|-----------------|---------------|
| `Signer` | `signer` | 1 |
| `Approver` | `approver` | 2 |

In the Anvil template editor, confirm each signature/date/initial field is
assigned to the correct signer.

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

Combine the DocuSign manifest and the Anvil import manifest into
`template-id-mapping.json`:

```json
{
  "mappings": [
    {
      "docusignTemplateId": "adbc1234-...",
      "docusignTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "roleMappings": { "Signer": "signer", "Approver": "approver" },
      "fieldMappings": { "CompanyName": "CompanyName", "EffectiveDate": "EffectiveDate" }
    }
  ]
}
```

---

## Step 7: Generate a database migration

Detect the developer's migration framework and generate a migration that:
- Adds Anvil EID columns (`cast_eid`, `etch_packet_eid`) **alongside** the existing
  DocuSign columns (`docusign_template_id`, `envelope_id`).
- Populates `cast_eid` from `template-id-mapping.json`.
- Leaves the DocuSign columns intact (removed after verification).

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
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE docusign_template_id = 'adbc1234-...';
```

**The developer runs the migration** — do not run it automatically. Tell them:
**"I've generated the migration at [path]. It adds Anvil EID columns alongside your
DocuSign columns and populates them from the template ID mapping. Please review and
run it when you're ready."**
