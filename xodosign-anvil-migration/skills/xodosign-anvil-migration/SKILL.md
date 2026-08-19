---
name: xodosign-anvil-migration
description: >
  Migrate existing Xodo Sign (formerly eversign) e-signature integrations to Anvil
  Etch E-Sign. Use this skill when a developer mentions migrating from Xodo Sign,
  eversign, the eversign REST API or `eversign` SDK, an access_key + business_id,
  documents/templates with signers/roles/positioned fields, document_hash, embedded
  signing (embedded_signing_url), or eversign webhook events (document_signed,
  document_completed, document_declined). Also trigger when someone mentions
  switching e-signature providers from Xodo Sign or eversign to Anvil, Xodo Sign /
  eversign alternatives or replacement, or converting Xodo Sign / eversign templates
  to Anvil.
---

# Xodo Sign (eversign) → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing Xodo Sign e-signature
integration to Anvil Etch E-Sign, preserving all existing functionality. Your job
is to discover what they have, map it to Anvil equivalents, migrate their templates,
rewrite code, and verify everything works.

**Xodo Sign is eversign.** "Xodo Sign" is the current brand for the product formerly
called **eversign**. The API is still hosted at `api.eversign.com`, the npm package
is still `eversign`, and integrations still authenticate with `access_key` +
`business_id`. Treat the two names as the same platform — the developer's code runs
against the eversign API regardless of which name they use.

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the Xodo Sign / eversign-specific discovery, mapping, and migration steps.

---

## Before you start: offer a migration overview

When the developer is **first** starting the migration — before discovery — ask:
**"Want a quick overview of how a Xodo Sign (eversign) → Anvil migration works — the
terminology differences and how the API calls line up?"**

If yes, share the two-paragraph summary below (keep it to these two paragraphs —
don't expand it). Write to a technical reader who's comfortable with code. If they'd
rather dive in, skip to Phase 1.

> **Terminology.** Your eversign *document* is an Anvil *Etch packet*
> (`createEtchPacket` → `etchPacketEid`); a *template* is a *Cast* (`castEid`); a
> template *role* is an Anvil *signer* with an arbitrary `id`; positioned *form
> fields* (`signature`, `text`, `date_signed`, keyed by `identifier`) become typed
> *fields* whose `identifier` maps to an `aliasId`; field `value`s and template
> *merge fields* (`{identifier, value}`) become a `data.payloads` prefill; and
> *embedded signing* (`embedded_signing` → a per-signer `embedded_signing_url`)
> becomes an embedded signer (`signerType: 'embedded'`). One `@anvilco/anvil` client
> replaces the eversign `Client`, and a single `ANVIL_API_KEY` replaces the
> `access_key` + `business_id` pair — no business selection.
>
> **API sequencing.** Where you call `createDocumentFromTemplate` (`template_id`,
> `signers[].role`, `fields[]`) — or `uploadFile` then `createDocument` with
> positioned `FormField`s — then wait on webhook events and
> `downloadFinalDocumentToPath` (+ `audit_trail`), Anvil collapses that to one
> `createEtchPacket` (files by `castEid`, each signer carrying its own `fields[]`,
> plus `data.payloads`; `isTest: true` while developing), then `generateEtchSignURL`
> + `AnvilEmbedFrame` for embedded signers, `createWebhookAction` for
> `signerComplete`/`etchPacketComplete` (eversign's
> `document_signed`/`document_completed`), and `downloadDocuments` (signed PDFs +
> certificate in one zip) on completion. Templates are flat PDFs with positioned
> fields, so each migrates via **PDF + Anvil Document AI** (dynamic docs only for
> content-based templates).

For the full vocabulary, see `references/terminology.md`; for the full API mapping
with before/after code, `references/api-mapping.md`.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every Xodo Sign / eversign integration
point. Present a complete findings summary before proceeding.

### Search for imports and packages

```
eversign
require('eversign')
from 'eversign'
new Client(
Template
Signer
Recipient
SignatureField
InitialsField
DateSignedField
```

Check `package.json` / lockfiles for the `eversign` package. (There is no separate
"xodosign" npm package — it's `eversign`.)

### Search for API endpoints

```
api.eversign.com
api.eversign.com/api
eversign.com/oauth
```

### Search for environment variables

```
EVERSIGN_API_KEY
EVERSIGN_ACCESS_KEY
EVERSIGN_BUSINESS_ID
XODOSIGN_API_KEY
XODO_SIGN_API_KEY
XODOSIGN_BUSINESS_ID
EVERSIGN_CLIENT_ID
EVERSIGN_CLIENT_SECRET
ACCESS_KEY
BUSINESS_ID
```

Check `.env`, `.env.*`, and deployment configs (Docker, Kubernetes, CI/CD).

### Search for SDK / API usage patterns

```
createDocument
createDocumentFromTemplate
getDocumentByHash
getAllDocuments
getTemplates
getDraftTemplates
uploadFile
appendSigner
appendFormField
appendField
setEmbeddedSigningEnabled
getEmbeddedSigningUrl
downloadFinalDocumentToPath
downloadRawDocumentToPath
sendReminderForDocument
cancelDocument
deleteDocument
fetchBusinesses
setSelectedBusinessById
```

For direct REST integrations, also search:

```
/api/document
/api/business
/api/file
download_final_document
download_raw_document
send_reminder
access_key=
business_id=
```

### Search for webhook handlers

```
document_sent
document_signed
document_completed
document_declined
document_cancelled
document_expired
document_viewed
event_hash
event_time
event_type
```

Also look for HMAC verification over `event_time` + `event_type` keyed by the API
access key.

### Search for database references

```
document_hash
eversign_document_id
eversign_template_id
xodosign_document_id
template_id
signing_url
embedded_signing_url
business_id
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — the installed `eversign` package + version
2. **SDK usage** — each file and the eversign calls it makes
3. **API endpoints** — any direct HTTP calls
4. **Environment variables** — which are referenced and where (`access_key`,
   `business_id`, OAuth)
5. **Webhook handlers** — routes + events handled
6. **Database references** — tables/columns storing document hashes / template IDs
7. **Templates used** — template IDs hardcoded or in config

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/terminology.md` for the vocabulary map (eversign term → Anvil term),
then `references/api-mapping.md` for the complete eversign → Anvil mapping (client
init, document/template → `createEtchPacket`, embedded signing, webhooks, templates,
the field-type table, auth, downloads, and how to list/read Anvil templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies to their integration,
**explicitly ask the developer how they want to handle it** — never silently drop a
feature. Pay special attention to:
- **CC recipients** — carried as non-signing recipients or handled app-level.
- **Signer PIN / SMS auth** — becomes an app-level auth wall.
- **Expiration / auto-reminders** — become app-level scheduling.
- **Document `meta` and multiple businesses** — `meta` moves to your DB; each
  `business_id` maps to a separate Anvil org/key.

Present the mapping summary:
1. **Direct equivalents** — send, signers, routing, embedded, fields, downloads
2. **Gaps with workarounds** — CC recipients, decline, expiration/reminders, bulk
   send, signer auth, `meta`
3. **Gaps needing decisions** — OAuth / multiple businesses

Ask: **"Are you comfortable with these mappings? Any concerns before we proceed?"**

---

## Phase 3: Environment Setup

### Anvil API key

Ask: **"Do you have an Anvil API key? If not, create an account at
https://app.useanvil.com/signup and find it under Organization Settings > API
Settings."**

Add it to `.env` and confirm `.env` is in `.gitignore`:

```
ANVIL_API_KEY=<add api key>
```

### Install the Anvil SDK

```bash
npm install @anvilco/anvil
```

If the integration uses embedded signing in a React frontend:

```bash
npm install @anvilco/anvil-embed-frame
```

### Keep Xodo Sign / eversign credentials temporarily

**Do not remove** the eversign `access_key` / `business_id` or the `eversign` SDK
yet — they're needed to export templates in Phase 4. Tell the developer:

**"I'm keeping your Xodo Sign (eversign) access key and Business ID in place for now
— we need them to export your existing templates. We'll remove them in Phase 6 after
verification."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. eversign templates are
**flat PDFs with positioned fields**, so the default target is **PDF + Anvil Document
AI**; dynamic docs are an optional target for content-based templates.

### Step 1: Export templates from Xodo Sign / eversign

Copy and run the bundled `scripts/export-xodosign-templates.ts`:

```bash
cp scripts/export-xodosign-templates.ts ./scripts/
npx ts-node scripts/export-xodosign-templates.ts --output-dir ./migrated-templates
```

It authenticates with the eversign `access_key` (`XODOSIGN_API_KEY` /
`EVERSIGN_API_KEY`) and `business_id`, lists templates (`GET /document?type=templates`),
downloads each template's PDF (`download_raw_document`), and writes one
`<title>.pdf` per template plus `xodosign-template-manifest.json` with metadata
(template ID, document hash, roles, recipients, fields with types + identifiers +
coordinates). Review the manifest with the developer.

### Step 2: Upload the PDFs to Anvil

Use the `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts` (Document
AI field detection):

```bash
npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates
```

Pass the manifest's field `identifier`s as suggested aliases so detected fields
carry your existing data keys. It writes `anvil-migration-manifest.json` with each
new `castEid`.

**Optional (dynamic docs):** for a content-heavy template, rebuild it as a dynamic
doc (create → `updateCast` content tree → `publishCast`) instead — see
`template-migration.md`.

### Step 3: Map roles, publish

- Record the role → signer-ID mapping (eversign `role` → Anvil signer id) and the
  field `identifier` → alias mapping.
- Open each template in the Anvil dashboard, confirm field tagging and signer
  assignments, and **publish** it (unpublished templates can't be used).

### Step 4: ID mapping + database migration

Combine both manifests into `template-id-mapping.json` (eversign `template_id` /
`document_hash` → Anvil `castEid`). Then generate a DB migration that adds Anvil EID
columns (`cast_eid`, `etch_packet_eid`) alongside the existing eversign columns and
populates them from the mapping. **Detect the developer's migration framework**
(Prisma / Knex / Sequelize / TypeORM / raw SQL) and match it.

**The developer runs the migration** — do not run it automatically.

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] templates** from Xodo Sign / eversign to `./migrated-templates/`
- **Uploaded [N] templates** to Anvil — `castEid`s are in `anvil-migration-manifest.json`
- **Generated a DB migration** at [path] mapping old template IDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file, working through the Phase 1 integration
points. Reference the `anvil-document-sdk` skill for Anvil patterns.

### Replace client initialization

Replace the eversign `new Client(accessKey, businessId)` with a single
`new Anvil({ apiKey })`. Drop the business selection (`fetchBusinesses` /
`setSelectedBusinessById`). See `references/api-mapping.md`.

### Rewrite document creation

Map each `createDocumentFromTemplate` (or `createDocument`) to `createEtchPacket`:
- `template_id` → `files[].castEid` (new IDs from Phase 4)
- `signers[].role` → `signers[].id`
- `signers[].name` / `.email` → `signers[].name` / `.email`
- `signers[].order` (+ `use_signer_order`) → `signers[].routingOrder`
- template merge `fields[].{identifier, value}` and positioned field `value`s →
  `data.payloads.{fileId}.data`
- `title` → `name`; `message` → `signatureEmailBody`
- `is_draft: true` → `isDraft: true`; `sandbox` → `isTest`
- For raw-file documents: upload each `File` as a Cast, and each positioned
  `FormField` becomes a tagged field on that Cast.

### Rewrite embedded signing

Replace `setEmbeddedSigningEnabled(true)` + `getEmbeddedSigningUrl()` with
`signerType: 'embedded'` + `generateEtchSignURL` + `AnvilEmbedFrame`. Map the
`redirect` / `redirect_decline` handling to the frame's `onEvent`
(`signerComplete` / `signerError`).

### Rewrite webhook handlers

Map eversign events to Anvil webhook events:
- `document_signed` → `signerComplete`
- `document_completed` → `etchPacketComplete`
- Remove the eversign `event_hash` verification; use Anvil's webhook verification
  instead. Register webhooks with `createWebhookAction`.

### Update environment variables

- Replace `EVERSIGN_*` / `XODOSIGN_*` vars (`access_key`, `business_id`, OAuth) with
  `ANVIL_API_KEY`
- Update `.env.example`

### Update database references

- `eversign_template_id` / `template_id` → `cast_eid`
- `document_hash` / `eversign_document_id` → `etch_packet_eid`
- Move eversign `meta` into your own columns/table (Anvil has no metadata bag)
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced SDK:** `eversign` → `@anvilco/anvil` in [N] files
- **Rewrote [N] document calls** to `createEtchPacket`
- **Rewrote embedded signing** to `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events
- **Updated environment variables** and database references

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 6: Verification

Guide the developer through verifying the migration end-to-end.

### Test mode

**"Set `isTest: true` on your Etch packets — test packets are watermarked and don't
count against your plan (the equivalent of eversign `sandbox`). Use a development
API key for testing."**

### Verification checklist

Walk each integration point from Phase 1:

1. **Templates** — for each migrated template: confirm it's published; verify field
   aliases match your data model; run a `fillPDF` to confirm data fills.
2. **Signature flows** — for each path: create a test packet with `isTest: true`; if
   embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based, verify
   the email arrives; complete a test signing.
3. **Webhooks** — confirm each webhook is registered; trigger a test event; verify
   the handler runs and document download works on completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm the
   signing certificate (eversign's Audit Trail) is included and stored.

### Clean up

Once the developer confirms everything works:

1. **Remove the eversign SDK:**
   ```bash
   npm uninstall eversign
   ```
2. **Remove Xodo Sign / eversign environment variables** from `.env`, `.env.example`,
   and deployment configs (`access_key`, `business_id`, OAuth).
3. **Remove old database columns** (optional) — ask: **"Generate a migration to drop
   the old eversign columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-xodosign-templates.ts`, `./migrated-templates/`,
   `template-id-mapping.json`.
5. **Final check:** search the codebase once more for stray `eversign` / Xodo Sign
   references.

Tell the developer: **"Migration complete! Your e-signature integration now runs on
Anvil. Switch from your development key to your production key and set
`isTest: false` when you're ready to go live."**

---

## Reference Links

- Anvil getting started: https://www.useanvil.com/docs/api/getting-started/
- Anvil Etch E-Sign docs: https://www.useanvil.com/docs/api/e-signatures/
- Anvil GraphQL reference: https://www.useanvil.com/docs/api/graphql/reference/
- Anvil Node.js client: https://github.com/anvilco/node-anvil
- Anvil React embed: https://github.com/anvilco/react-ui
- Xodo Sign / eversign API reference: https://eversign.com/api/documentation
- eversign Node SDK: https://github.com/eversign/eversign-node-sdk
