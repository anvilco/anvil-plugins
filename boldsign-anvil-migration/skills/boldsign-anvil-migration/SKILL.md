---
name: boldsign-anvil-migration
description: >
  Migrate existing BoldSign e-signature integrations to Anvil Etch E-Sign.
  Use this skill when a developer mentions migrating from BoldSign, the boldsign
  SDK/npm package, the BoldSign REST API, documents, templates, roles, positioned
  form fields, embedded sign links (getEmbeddedSignLink), createEmbeddedRequestUrl,
  or BoldSign webhooks, or wants to replace their BoldSign integration with Anvil.
  Also trigger when someone mentions switching e-signature providers from BoldSign
  to Anvil, BoldSign alternatives, BoldSign replacement, converting BoldSign
  templates to Anvil, or BoldSign-to-Anvil migration.
---

# BoldSign → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing BoldSign e-signature integration
to Anvil Etch E-Sign, preserving all existing functionality. Your job is to discover
what they have, map it to Anvil equivalents, migrate their templates, rewrite code,
and verify everything works.

**What BoldSign is:** a REST e-signature API where documents are sent from **flat
PDF templates with positioned form fields** (each field placed by absolute `bounds`
on a `pageNumber`). Template migration is therefore a **PDF download + Anvil
Document AI** re-detection pass (like the DropboxSign migration), with an optional
dynamic-doc rebuild for content-heavy templates (Phase 4).

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the BoldSign-specific discovery, mapping, and migration steps.

---

## Before you start: offer a migration overview

When the developer is **first** starting the migration — before discovery — ask:
**"Want a quick overview of how a BoldSign → Anvil migration works — the terminology
differences and how the API calls line up?"**

If yes, share the two-paragraph summary below (keep it to these two paragraphs —
don't expand it). Write to a technical reader who's comfortable with code. If they'd
rather dive in, skip to Phase 1.

> **Terminology.** Your BoldSign *document* is an Anvil *Etch packet*
> (`createEtchPacket` → `etchPacketEid`); a *template* is a *Cast* (`castEid`); a
> template *role* (`roleIndex` / `signerRole`) is an Anvil *signer* with an arbitrary
> `id`; positioned *form fields* (`fieldType` + `bounds` x/y/width/height on a
> `pageNumber`) become typed *fields* keyed by `aliasId`; a form field's `value` (or
> `existingFormFields` on a template send) becomes a `data.payloads` prefill; and an
> embedded sign link (`getEmbeddedSignLink` → `signLink`) becomes an embedded signer
> (`signerType: 'embedded'`). One `@anvilco/anvil` client replaces `DocumentApi` /
> `TemplateApi`, and a single `ANVIL_API_KEY` replaces `X-API-KEY` / OAuth **and** the
> region-specific host (`api.boldsign.com` vs `eu-api.boldsign.com`).
>
> **API sequencing.** Where you `POST /v1/template/send` (`roles[]` with
> `existingFormFields`), then `getEmbeddedSignLink` for embedded signers, rely on a
> dashboard-configured webhook for `Signed`/`Completed` (verified via
> `X-BoldSign-Signature`), then `GET /v1/document/download` **and**
> `downloadAuditLog` separately — Anvil collapses that to one `createEtchPacket`
> (files by `castEid`, each signer carrying its own `fields[]`, plus `data.payloads`;
> `isTest: true` while developing), then `generateEtchSignURL` + `AnvilEmbedFrame` for
> embedded signers, `createWebhookAction` for `signerComplete`/`etchPacketComplete`,
> and `downloadDocuments` (signed PDFs + certificate in one zip) on completion.
> Templates migrate by downloading each template's PDF and re-detecting fields in
> Anvil (Document AI assists), since BoldSign fields are positioned on a flat PDF.

For the full vocabulary, see `references/terminology.md`; for the full API mapping
with before/after code, `references/api-mapping.md`.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every BoldSign integration point.
Present a complete findings summary before proceeding.

### Search for imports and packages

```
boldsign
BoldSign
DocumentApi
TemplateApi
Configuration        (from 'boldsign')
EmbeddedDocumentApi
SendForSign
```

Check `package.json` / lockfiles for `boldsign` (or a direct HTTP client hitting
BoldSign).

### Search for API endpoints

```
api.boldsign.com
eu-api.boldsign.com
/v1/document/send
/v1/template/send
/v1/document/getEmbeddedSignLink
/v1/document/createEmbeddedRequestUrl
/v1/document/download
/v1/document/downloadAuditLog
/v1/template/list
/v1/template/properties
```

### Search for environment variables

```
BOLDSIGN_API_KEY
BOLDSIGN_CLIENT_ID
BOLDSIGN_CLIENT_SECRET
BOLDSIGN_WEBHOOK_SECRET
BOLDSIGN_BASE_URL
BOLDSIGN_REGION
```

Check `.env`, `.env.*`, and deployment configs (Docker, Kubernetes, CI/CD).

### Search for SDK / REST usage patterns

(These mirror the REST endpoints above; grep both the method-style names and the
endpoint fragments.)

```
sendDocument
sendDocumentFromTemplate
getEmbeddedSignLink
createEmbeddedRequestUrl
getProperties          (template properties)
listTemplates
listDocuments
downloadDocument
downloadAuditLog
revokeDocument
remindDocument
existingFormFields
signerOrder
```

### Search for webhook handlers

BoldSign webhooks are configured in the **dashboard** (not in the send call), so
look for the receiving route and the event-type switch:

```
X-BoldSign-Signature
BoldSign-Signature
eventType
Signed
Completed
Declined
Revoked
Expired
```

Also look for HMAC verification (`X-BoldSign-Signature`, `createHmac`,
`BOLDSIGN_WEBHOOK_SECRET`).

### Search for database references

```
boldsign_document_id
boldsign_template_id
documentId
templateId
document_id
template_id
sign_link
signing_url
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — installed `boldsign` package + version
2. **SDK usage** — each file and the BoldSign calls it makes
3. **API endpoints** — any direct HTTP calls (note US vs EU host)
4. **Environment variables** — which are referenced and where
5. **Webhook handlers** — the receiving route + events handled
6. **Database references** — tables/columns storing BoldSign IDs
7. **Templates used** — template IDs hardcoded or in config

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/terminology.md` for the vocabulary map (BoldSign term → Anvil
term), then `references/api-mapping.md` for the complete BoldSign → Anvil mapping
(client init, document/template send → `createEtchPacket`, embedded signing,
webhooks, templates, positioned fields, auth, downloads, and how to list/read Anvil
templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies to their integration,
**explicitly ask the developer how they want to handle it** — never silently drop a
feature. Pay special attention to:
- **Webhooks** — BoldSign's dashboard-configured, account/app-scoped webhook becomes
  a programmatic `createWebhookAction`; the HMAC check goes away.
- **Embedded surfaces** — separate the *signer* sign link (`getEmbeddedSignLink` →
  `generateEtchSignURL`) from the *sender* request URL (`createEmbeddedRequestUrl` →
  Anvil embedded builder).
- **Signer authentication** (access code / SMS / email OTP) → app-level auth wall.

Present the mapping summary:
1. **Direct equivalents** — most things (send, signers, routing, embedded signing, fields)
2. **Gaps with workarounds** — CC recipients, reminders/expiration, decline, revoke, bulk send, signer auth
3. **Gaps needing decisions** — embedded sending (builder), OAuth multi-tenant / on-behalf

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

### Keep BoldSign credentials temporarily

**Do not remove** the BoldSign API key or SDK yet — they're needed to export
templates in Phase 4. Tell the developer:

**"I'm keeping your BoldSign API key and SDK in place for now — we need them to
export your existing templates. We'll remove them in Phase 6 after verification."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. BoldSign templates are
flat PDFs with positioned fields, so the default target is **PDF + Anvil Document AI
(Target B)**, with a **dynamic-doc rebuild (Target A)** offered for content-heavy
templates.

### Step 1: Export templates from BoldSign

Copy and run the bundled `scripts/export-boldsign-templates.ts`:

```bash
cp scripts/export-boldsign-templates.ts ./scripts/
npx ts-node scripts/export-boldsign-templates.ts --output-dir ./migrated-templates
```

It authenticates with `BOLDSIGN_API_KEY`, lists templates, and for each downloads
the PDF (`GET /v1/template/download`) plus its roles and positioned form fields
(`GET /v1/template/properties`), writing the PDFs + a
`boldsign-template-manifest.json`. Pass `--region eu` for EU accounts. Review the
manifest with the developer.

### Step 2: Choose a target per template

Present the tiered rule from `template-migration.md`:
- **PDF + Document AI (default)** — faithful to BoldSign's fixed-PDF templates; uses
  only the stable public API.
- **Dynamic doc (optional)** — only for content-heavy/reflowing/repeating-table
  templates that should stay editable in Anvil. It's a *rebuild* (BoldSign has no
  content-tree export), authored via create → `updateCast` → publish.

When unsure, default to PDF + Document AI.

### Step 3: Import to Anvil

- **PDF + Document AI:** upload the exported PDFs with the `anvil-document-sdk`
  plugin's `scripts/migrate-pdfs-to-anvil.ts` (Document AI field detection), then
  re-tag fields using the manifest's field positions/types.
- **Dynamic doc:** build the content tree from the manifest and run create →
  `updateCast` → `publishCast` (see `template-migration.md`).

### Step 4: Map roles/fields/prefill, ID mapping, DB migration

- Record role → signer-ID, field → alias, and prefill → data-key mappings.
- Combine both manifests into `template-id-mapping.json` (BoldSign `templateId` →
  Anvil `castEid`).
- Generate a DB migration that adds `cast_eid` / `etch_packet_eid` alongside the
  existing BoldSign columns and populates them from the mapping. **Detect the
  developer's migration framework** (Prisma / Knex / Sequelize / TypeORM / raw SQL)
  and match it. **The developer runs it** — do not run it automatically.

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] templates** from BoldSign to `./migrated-templates/`
- **Imported [N] templates** to Anvil ([X] as PDFs, [Y] as dynamic docs) — `castEid`s
  are in `anvil-migration-manifest.json`
- **Generated a DB migration** at [path] mapping old template IDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file, working through the Phase 1 integration
points. Reference the `anvil-document-sdk` skill for Anvil patterns.

### Replace client initialization

Replace the BoldSign `Configuration` + `DocumentApi` / `TemplateApi` (and the
region-specific `basePath`) with a single `new Anvil({ apiKey })`. See
`references/api-mapping.md`.

### Rewrite document send

Map each `POST /v1/template/send` (or `/v1/document/send`) to `createEtchPacket`:
- `templateId` → `files[].castEid` (new IDs from Phase 4)
- `roles[].roleIndex` / `signerRole` → `signers[].id`
- `roles[].signerName` / `signerEmail` → `signers[].name` / `email`
- `roles[].signerOrder` (+ `enableSigningOrder`) → `signers[].routingOrder`
- `existingFormFields[].value` / form field `value` → `data.payloads.{fileId}.data`
- `title` / `message` → `signatureEmailSubject` / `signatureEmailBody`
- sandbox key / sandbox mode → `isTest: true`

### Rewrite embedded signing

Replace `getEmbeddedSignLink` (`signLink`) with `signerType: 'embedded'` +
`generateEtchSignURL` + `AnvilEmbedFrame`. Map the completion redirect/event to the
frame's `onEvent` (`signerComplete` / `signerError`). If the app uses
`createEmbeddedRequestUrl` (in-app *sending*), map it to Anvil's embedded builder —
see `feature-parity.md`.

### Rewrite webhook handlers

Map BoldSign events to Anvil webhook events:
- `Signed` → `signerComplete`
- `Completed` → `etchPacketComplete`
- Remove the `X-BoldSign-Signature` HMAC verification and the dashboard webhook
  config; register webhooks programmatically with `createWebhookAction` and use
  Anvil's webhook verification instead.

### Update environment variables

- Replace all `BOLDSIGN_*` vars with `ANVIL_API_KEY`
- Remove OAuth vars (`BOLDSIGN_CLIENT_ID`, `BOLDSIGN_CLIENT_SECRET`), the region host
  (`BOLDSIGN_BASE_URL` / `BOLDSIGN_REGION`), and the webhook secret
- Update `.env.example`

### Update database references

- `boldsign_template_id` → `cast_eid`
- `boldsign_document_id` → `etch_packet_eid`
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced SDK:** `boldsign` → `@anvilco/anvil` in [N] files
- **Rewrote [N] send calls** to `createEtchPacket`
- **Rewrote embedded signing** to `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events (programmatic registration)
- **Updated environment variables** and database references

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 6: Verification

Guide the developer through verifying the migration end-to-end.

### Test mode

**"Set `isTest: true` on your Etch packets — test packets are watermarked and don't
count against your plan. Use a development API key for testing."**

### Verification checklist

Walk each integration point from Phase 1:

1. **Templates** — for each migrated template: confirm it's published; verify field
   aliases + positions match your data model; run a `fillPDF` to confirm data fills.
2. **Signature flows** — for each path: create a test packet with `isTest: true`; if
   embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based, verify
   the email arrives; complete a test signing.
3. **Webhooks** — confirm each webhook is registered via `createWebhookAction`;
   trigger a test event; verify the handler runs and document download works on
   completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm the
   signing certificate is included (no separate audit-log call needed) and stored.

### Clean up

Once the developer confirms everything works:

1. **Remove the BoldSign SDK:**
   ```bash
   npm uninstall boldsign
   ```
2. **Remove BoldSign environment variables** from `.env`, `.env.example`, and
   deployment configs, and remove the dashboard webhook configuration in BoldSign.
3. **Remove old database columns** (optional) — ask: **"Generate a migration to drop
   the old BoldSign columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-boldsign-templates.ts`, `scripts/migrate-pdfs-to-anvil.ts` (if
   copied), `./migrated-templates/`, `template-id-mapping.json`.
5. **Final check:** search the codebase once more for stray BoldSign references.

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
- Anvil webhooks: https://www.useanvil.com/docs/api/webhooks/
- BoldSign API reference: https://developers.boldsign.com/
