---
name: adobesign-anvil-migration
description: >
  Migrate existing Adobe Acrobat Sign (Adobe Sign) e-signature integrations to Anvil
  Etch E-Sign. Use this skill when a developer mentions migrating from Adobe Sign,
  Acrobat Sign, EchoSign, the Adobe Sign / eSign REST API v6, transient documents,
  library documents, agreements, participantSetsInfo, signing URLs, or Adobe Sign
  webhooks, or wants to replace their Adobe Sign integration with Anvil. Also trigger
  when someone mentions switching e-signature providers from Adobe Sign to Anvil,
  Adobe Sign alternatives, Adobe Sign replacement, converting Adobe Sign library
  documents/templates to Anvil, or Adobe-Sign-to-Anvil migration.
---

# Adobe Acrobat Sign → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing Adobe Acrobat Sign (Adobe Sign,
formerly EchoSign) e-signature integration to Anvil Etch E-Sign, preserving all
existing functionality. Your job is to discover what they have, map it to Anvil
equivalents, migrate their templates, rewrite code, and verify everything works.

**What's heaviest about Adobe Sign:** its **access model**, not its documents.
Every call runs on a data-center-specific host discovered via `GET /baseUris` (or
`api_access_point` from the OAuth token), authenticated with **OAuth2 or an
Integration Key** and optionally an `x-api-user` impersonation header. Anvil
collapses all of that into a single `ANVIL_API_KEY` on one fixed host. Adobe
**library documents** are flat PDFs, so templates migrate via **PDF + Anvil
Document AI** (Phase 4), with a **dynamic-doc** option for content-based agreements.

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the Adobe-Sign-specific discovery, mapping, and migration steps.

---

## Before you start: offer a migration overview

When the developer is **first** starting the migration — before discovery — ask:
**"Want a quick overview of how an Adobe Sign → Anvil migration works — the
terminology differences and how the API calls line up?"**

If yes, share the two-paragraph summary below (keep it to these two paragraphs —
don't expand it). Write to a technical reader who's comfortable with code. If they'd
rather dive in, skip to Phase 1.

> **Terminology.** Your Adobe *agreement* is an Anvil *Etch packet*
> (`createEtchPacket` → `etchPacketEid`); a *library document* (template) is a *Cast*
> (`castEid`); a *transient document* (`POST /transientDocuments` →
> `transientDocumentId`) is just an uploaded file, which in Anvil is a `createCast`
> upload. *participantSetsInfo* becomes *signers*: each set's `order` →
> `routingOrder`, its `role` (`SIGNER`, `APPROVER`, `ACCEPTOR`, `FORM_FILLER`, …) →
> a signer (or a non-signing recipient); `memberInfos[].email` → `signers[].email`.
> *Form fields* become *Cast field aliases*, and *`mergeFieldInfo`* prefill
> (`{ fieldName, defaultValue }`) becomes a `data.payloads` payload keyed by alias.
> One `@anvilco/anvil` client with a single `ANVIL_API_KEY` replaces OAuth2 / the
> Integration Key, the `GET /baseUris` shard-discovery step, and `x-api-user`
> impersonation.
>
> **API sequencing.** Where you upload a transient doc, `POST /agreements`
> (`fileInfos`, `participantSetsInfo`, `signatureType`, `state: "IN_PROCESS"`),
> `GET /agreements/{id}/signingUrls` for embedded signers, register a webhook and
> wait for `AGREEMENT_WORKFLOW_COMPLETED`, then pull
> `GET /agreements/{id}/combinedDocument` + `/auditTrail` — Anvil collapses that to
> one **synchronous** `createEtchPacket` (files by `castEid`, each signer carrying
> its own `fields[]`, plus `data.payloads`; `isTest: true` while developing), then
> `generateEtchSignURL` + `AnvilEmbedFrame` for embedded signers,
> `createWebhookAction` for `signerComplete`/`etchPacketComplete`, and
> `downloadDocuments` (signed PDFs + certificate in one zip) on completion. The v6
> authoring-state form-field dance (`state: "AUTHORING"` → `PUT …/formFields`)
> disappears — templates carry their fields.

For the full vocabulary, see `references/terminology.md`; for the full API mapping
with before/after code, `references/api-mapping.md`.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every Adobe Sign integration point.
Present a complete findings summary before proceeding.

### Search for imports and packages

Adobe ships official **Java / C# / Python** SDKs and REST samples, but no
first-party Node SDK — most JS integrations use a community package or raw
`axios`/`fetch`. Search for:

```
adobe-sign-sdk
node-adobe-sign
adobe-sign
acrobat-sign
echosign
swagger_client        (generated from the v6 OpenAPI spec)
AdobeSignClient
```

Check `package.json` / lockfiles, and note any raw HTTP client that targets an
Adobe Sign host (below) — that counts as an integration point too.

### Search for API endpoints and hosts

```
adobesign.com
echosign.com
/api/rest/v6
/api/rest/v5
api.na1.adobesign.com
secure.na1.adobesign.com
/baseUris
/transientDocuments
/agreements
/libraryDocuments
/widgets
/oauth/v2/token
/oauth/v2/authorize
```

The shard is per-account (`na1`, `na2`, `na3`, `na4`, `eu1`, `eu2`, `au1`, `jp1`,
`in1`, …). Look for a hardcoded host **or** a `GET /baseUris` / `api_access_point`
lookup that sets it dynamically.

### Search for environment variables

```
ADOBE_SIGN_CLIENT_ID
ADOBE_SIGN_CLIENT_SECRET
ADOBE_SIGN_INTEGRATION_KEY
ADOBE_SIGN_ACCESS_TOKEN
ADOBE_SIGN_REFRESH_TOKEN
ADOBE_SIGN_BASE_URI
ADOBE_SIGN_API_ACCESS_POINT
ADOBE_SIGN_ACCOUNT_ID
ADOBE_SIGN_SCOPES
ADOBE_SIGN_WEBHOOK_ID
ADOBE_SIGN_WEBHOOK_CLIENT_ID
ADOBESIGN_*
ECHOSIGN_*
```

Check `.env`, `.env.*`, and deployment configs (Docker, Kubernetes, CI/CD).

### Search for SDK / REST usage patterns

```
transientDocuments        (upload a file → transientDocumentId)
createTransientDocument
participantSetsInfo        (recipients grouped into sets)
memberInfos
mergeFieldInfo             (prefill → { fieldName, defaultValue })
signingUrlSetInfos
signingUrls                (GET /agreements/{id}/signingUrls — embedded signing)
combinedDocument           (download signed PDF)
auditTrail                 (download the audit report)
formFields                 (PUT /agreements/{id}/formFields — v6 authoring)
libraryDocuments
libraryDocumentId
widgets                    (web forms)
x-api-user                 (sender impersonation header)
GET /baseUris
```

### Search for webhook handlers

```
AGREEMENT_CREATED
AGREEMENT_ACTION_COMPLETED
AGREEMENT_WORKFLOW_COMPLETED
AGREEMENT_ACTION_DELEGATED
AGREEMENT_EMAIL_VIEWED
webhookSubscriptionEvents
webhookEndpointInfo
x-adobesign-clientid          (intent-verification + payload header)
```

Adobe Sign verifies a new webhook by replaying the request and expecting the
`X-AdobeSign-ClientId` back (in a header or JSON body). Look for that echo handler
and for the `x-adobesign-clientid` check on delivered events.

### Search for database references

```
adobe_sign_agreement_id
agreement_id
adobesign_template_id
library_document_id
transient_document_id
participant_id
signing_url
widget_id
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — Adobe Sign SDK/HTTP client + versions
2. **SDK usage** — each file and the Adobe Sign calls it makes
3. **API endpoints** — direct HTTP calls, and how the base URI is resolved
4. **Environment variables** — which are referenced and where; OAuth vs Integration Key
5. **Webhook handlers** — routes + events handled, and the client-id verification
6. **Database references** — tables/columns storing Adobe Sign IDs
7. **Templates used** — library document IDs hardcoded or in config

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/terminology.md` for the vocabulary map (Adobe Sign term → Anvil
term), then `references/api-mapping.md` for the complete Adobe Sign v6 → Anvil
mapping (auth + base-URI discovery, transient/library documents → Cast, agreement →
`createEtchPacket`, participant sets → signers, form fields / `mergeFieldInfo`,
embedded signing, webhooks, downloads, and how to list/read Anvil templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies to their integration,
**explicitly ask the developer how they want to handle it** — never silently drop a
feature. Pay special attention to:

- **Participant *sets* with multiple members** — an Adobe set's members are
  *alternates* (any one may act). Anvil signers sharing a `routingOrder` sign in
  *parallel* (all act). Confirm which each set really means.
- **Non-signing roles** — `CC`, `CERTIFIED_RECIPIENT`, `APPROVER`, `FORM_FILLER`
  need explicit handling (every Anvil signer must own ≥1 field).
- **Web forms (widgets)** and **signer auth (phone/KBA/password)** — no 1:1 Anvil
  feature; decide per use case.

Present the mapping summary:
1. **Direct equivalents** — send, signers, routing (`order`→`routingOrder`),
   embedded signing, fields, prefill
2. **Gaps with workarounds** — CC/approver roles, alternate members, reminders/
   expiration, bulk send, signer auth
3. **Gaps needing decisions** — web forms, OAuth multi-tenant, `x-api-user` flows

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

### Keep Adobe Sign credentials temporarily

**Do not remove** the Adobe Sign credentials or SDK yet — they're needed to export
library documents in Phase 4. Tell the developer:

**"I'm keeping your Adobe Sign credentials in place for now — we need them to export
your existing library documents. We'll remove them in Phase 6 after verification. If
your token is short-lived, have a fresh OAuth access token (or Integration Key)
ready for the export."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. Adobe **library
documents** are flat PDFs with positioned form fields, so the default path is **PDF
+ Anvil Document AI** (Target B), with an optional **dynamic doc** (Target A) for
content-heavy agreements — chosen per template.

### Step 1: Export library documents from Adobe Sign

Copy and run the bundled `scripts/export-adobesign-templates.ts`:

```bash
cp scripts/export-adobesign-templates.ts ./scripts/
npx ts-node scripts/export-adobesign-templates.ts --output-dir ./migrated-templates
```

It resolves the account's API base URI (`GET /baseUris`, or `--base-uri`),
lists library documents (`GET /libraryDocuments`), and for each downloads the
combined PDF (`GET /libraryDocuments/{id}/combinedDocument`) plus its form-field
and participant metadata, writing the PDFs + `adobesign-template-manifest.json`.
Review the manifest with the developer.

### Step 2: Choose a target per template, then import

Present the tiered rule from `template-migration.md`:

- **PDF + Document AI (default)** — fixed-layout PDFs, most library documents.
  Upload the exported PDFs with the `anvil-document-sdk` plugin's
  `scripts/migrate-pdfs-to-anvil.ts` (Document AI detects fields), then re-tag.
- **Dynamic doc (higher fidelity)** — content-heavy / reflowing agreements or ones
  that should stay editable in Anvil. Build the content tree and run create →
  `updateCast` → `publishCast` (see `template-migration.md`).

### Step 3: Map roles → signers, fields → aliases, and publish

- Record the participant-role → signer-ID mapping (e.g. `SIGNER` → `signer`,
  `APPROVER` → `approver`) and each set's `order` → `routingOrder`.
- In the Anvil template editor, confirm field aliases match your data model and each
  signature/date field is assigned to the right signer.
- **Publish** each template — unpublished Casts error from `fillPDF`/`createEtchPacket`.

### Step 4: ID mapping + database migration

Combine the export manifest with the new `castEid`s into `template-id-mapping.json`
(Adobe `libraryDocumentId` → Anvil `castEid`). Then generate a DB migration that
adds Anvil EID columns (`cast_eid`, `etch_packet_eid`) **alongside** the existing
Adobe Sign columns and populates them from the mapping. **Detect the developer's
migration framework** (Prisma / Knex / Sequelize / TypeORM / raw SQL) and match it.

**The developer runs the migration** — do not run it automatically.

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] library documents** from Adobe Sign to `./migrated-templates/`
- **Imported [N] templates** to Anvil ([X] as PDFs, [Y] as dynamic docs) — `castEid`s
  are in the import manifest
- **Generated a DB migration** at [path] mapping old library document IDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file, working through the Phase 1 integration
points. Reference the `anvil-document-sdk` skill for Anvil patterns.

### Replace client initialization + base-URI discovery

Replace the OAuth token exchange / Integration Key, the `GET /baseUris`
(`api_access_point`) lookup, and any `x-api-user` header with a single
`new Anvil({ apiKey })`. See `references/api-mapping.md`.

### Rewrite agreement creation

Collapse the transient-upload → `POST /agreements` flow into one `createEtchPacket`:
- `fileInfos[].libraryDocumentId` / `transientDocumentId` → `files[].castEid` (new IDs from Phase 4)
- `participantSetsInfo[].role` → `signers[].id`; `memberInfos[].email` → `signers[].email`
- `participantSetsInfo[].order` → `signers[].routingOrder`
- `mergeFieldInfo[]` (`{ fieldName, defaultValue }`) → `data.payloads.{fileId}.data`
- `name` → `name`; `message` → `signatureEmailBody`
- `state: "IN_PROCESS"` → send (default); `state: "DRAFT"`/`"AUTHORING"` → `isDraft: true`
- **Delete the v6 authoring dance** (`state: "AUTHORING"` + `PUT …/formFields`) — the Cast already carries its fields.

### Rewrite embedded signing

Replace `GET /agreements/{id}/signingUrls` (+ email suppression via `emailOption`)
and reading `signingUrlSetInfos[].signingUrls[].esignUrl` with `signerType:
'embedded'` + `generateEtchSignURL` + `AnvilEmbedFrame`.

### Rewrite webhook handlers

Map Adobe Sign webhook events to Anvil webhook events:
- `AGREEMENT_ACTION_COMPLETED` (a participant finished) → `signerComplete`
- `AGREEMENT_WORKFLOW_COMPLETED` (all done) → `etchPacketComplete`
- Remove the `X-AdobeSign-ClientId` intent-verification + echo handler; use Anvil's
  webhook verification instead. Register webhooks with `createWebhookAction`.

### Update environment variables

- Replace all `ADOBE_SIGN_*` / `ECHOSIGN_*` vars with `ANVIL_API_KEY`
- Remove OAuth vars (`CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`), the Integration
  Key, `BASE_URI`/`API_ACCESS_POINT`, `ACCOUNT_ID`, and webhook client-id vars
- Update `.env.example`

### Update database references

- `adobesign_template_id` / `library_document_id` → `cast_eid`
- `adobe_sign_agreement_id` / `agreement_id` → `etch_packet_eid`
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced the Adobe Sign client:** OAuth/Integration-Key + `baseUris` discovery →
  `@anvilco/anvil` in [N] files
- **Rewrote [N] agreement calls** to `createEtchPacket`
- **Rewrote embedded signing** to `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events
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
   aliases match your data model; run a `fillPDF` to confirm data fills (PDFs and
   dynamic docs both fill via the same `data` mechanism).
2. **Signature flows** — for each path: create a test packet with `isTest: true`; if
   embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based, verify
   the email arrives; complete a test signing. Re-check any multi-`order` routing.
3. **Webhooks** — confirm each webhook is registered; trigger a test event; verify the
   handler runs and document download works on completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm the
   signing certificate is included and stored (replaces Adobe's separate
   `combinedDocument` + `auditTrail` fetches).

### Clean up

Once the developer confirms everything works:

1. **Remove the Adobe Sign SDK / HTTP client** (whatever was in use):
   ```bash
   npm uninstall adobe-sign-sdk   # or the community/HTTP package in the project
   ```
2. **Remove Adobe Sign environment variables** from `.env`, `.env.example`, and
   deployment configs (OAuth, Integration Key, base URI, account ID, webhook client id).
3. **Remove old database columns** (optional) — ask: **"Generate a migration to drop
   the old Adobe Sign columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-adobesign-templates.ts`, `./migrated-templates/`,
   `template-id-mapping.json`.
5. **Final check:** search the codebase once more for stray Adobe Sign / EchoSign
   references.

Tell the developer: **"Migration complete! Your e-signature integration now runs on
Anvil. Switch from your development key to your production key and set `isTest:
false` when you're ready to go live."**

---

## Reference Links

- Anvil getting started: https://www.useanvil.com/docs/api/getting-started/
- Anvil Etch E-Sign docs: https://www.useanvil.com/docs/api/e-signatures/
- Anvil GraphQL reference: https://www.useanvil.com/docs/api/graphql/reference/
- Anvil Node.js client: https://github.com/anvilco/node-anvil
- Anvil React embed: https://github.com/anvilco/react-ui
- Adobe Acrobat Sign REST API v6: https://opensource.adobe.com/acrobat-sign/developer_guide/
- Adobe Sign v6 API reference (per-account Swagger): `https://secure.<shard>.adobesign.com/public/docs/restapi/v6`
