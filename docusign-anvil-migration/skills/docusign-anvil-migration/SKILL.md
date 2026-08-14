---
name: docusign-anvil-migration
description: >
  Migrate existing DocuSign eSignature integrations to Anvil Etch E-Sign.
  Use this skill when a developer mentions migrating from DocuSign, docusign-esign,
  the DocuSign eSignature REST API, envelopes, templateRoles, recipient views, or
  DocuSign Connect webhooks, or wants to replace their DocuSign integration with
  Anvil. Also trigger when someone mentions switching e-signature providers from
  DocuSign to Anvil, DocuSign alternatives, DocuSign replacement, converting
  DocuSign templates to Anvil, or DocuSign-to-Anvil migration.
---

# DocuSign → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing DocuSign eSignature
integration to Anvil Etch E-Sign, preserving all existing functionality. Your job
is to discover what they have, map it to Anvil equivalents, migrate their
templates, rewrite code, and verify everything works.

**The DocuSign advantage:** Anvil can convert a DocuSign template/envelope
definition directly into an Anvil template — preserving field geometry, field
types, and signer roles. This makes template migration far higher-fidelity than a
PDF re-detection pass. Lean on it (Phase 4).

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the DocuSign-specific discovery, mapping, and migration steps.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every DocuSign integration point.
Present a complete findings summary before proceeding.

### Search for imports and packages

```
docusign-esign
docusign-admin
docusign-click
docusign-rooms
ApiClient
EnvelopesApi
TemplatesApi
requestJWTUserToken
generateAccessToken
EnvelopeDefinition
RecipientViewRequest
```

Check `package.json` / lockfiles for `docusign-esign` (and other `docusign-*`
packages).

### Search for API endpoints

```
docusign.net/restapi
account-d.docusign.com
account.docusign.com
account-s.docusign.com
/oauth/token
/oauth/userinfo
/restapi/v2.1
```

### Search for environment variables

```
DOCUSIGN_INTEGRATION_KEY
DOCUSIGN_CLIENT_ID
DOCUSIGN_CLIENT_SECRET
DOCUSIGN_USER_ID
DOCUSIGN_ACCOUNT_ID
DOCUSIGN_BASE_URI
DOCUSIGN_BASE_PATH
DOCUSIGN_PRIVATE_KEY
DOCUSIGN_RSA_PRIVATE_KEY
DOCUSIGN_SECRET_KEY
DOCUSIGN_AUTH_SERVER
DOCUSIGN_HMAC_KEY
DOCUSIGN_WEBHOOK_SECRET
```

Check `.env`, `.env.*`, and deployment configs (Docker, Kubernetes, CI/CD).

### Search for SDK usage patterns

```
createEnvelope
createRecipientView
createSenderView
listStatusChanges
getEnvelope
getDocument
listTemplates
getTemplate
createTemplate
templateRoles
compositeTemplates
requestJWTUserToken
getUserInfo
updateEnvelope        (void / status changes)
createRecipient
bulkSend
```

### Search for webhook handlers (DocuSign Connect)

```
envelope-completed
envelope-sent
envelope-delivered
envelope-declined
envelope-voided
recipient-completed
recipient-sent
recipient-delivered
X-DocuSign-Signature-1
eventNotification
Connect
```

Also look for HMAC verification (`X-DocuSign-Signature-1`, `createHmac`,
`DOCUSIGN_HMAC_KEY`).

### Search for database references

```
envelope_id
envelopeId
docusign_template_id
docusign_envelope_id
template_id
recipient_id
signing_url
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — installed `docusign-*` packages + versions
2. **SDK usage** — each file and the DocuSign calls it makes
3. **API endpoints** — any direct HTTP calls
4. **Environment variables** — which are referenced and where
5. **Webhook handlers** — Connect routes + events handled
6. **Database references** — tables/columns storing DocuSign IDs
7. **Templates used** — template IDs hardcoded or in config

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/api-mapping.md` for the complete DocuSign → Anvil mapping
(client init, envelope → `createEtchPacket`, embedded signing, webhooks,
templates, tabs, auth, downloads, and how to list/read Anvil templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies to their
integration, **explicitly ask the developer how they want to handle it** — never
silently drop a feature.

Present the mapping summary:
1. **Direct equivalents** — most things (send, signers, routing, embedded, fields)
2. **Gaps with workarounds** — CC recipients, reminders/expiration, decline, bulk
   send, signer auth
3. **Gaps needing decisions** — agents/editors, OAuth multi-tenant

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

### Keep DocuSign credentials temporarily

**Do not remove** the DocuSign credentials or SDK yet — they're needed to export
templates in Phase 4. Tell the developer:

**"I'm keeping your DocuSign credentials in place for now — we need them to export
your existing templates. We'll remove them in Phase 6 after verification."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. DocuSign templates
migrate via the **JSON converter (Path A, recommended)** with a **PDF + Document
AI fallback (Path B)**.

### Step 1: Export templates from DocuSign

Copy and run the bundled `scripts/export-docusign-templates.ts`:

```bash
cp scripts/export-docusign-templates.ts ./scripts/
npx ts-node scripts/export-docusign-templates.ts --output-dir ./migrated-templates
```

It authenticates with a DocuSign access token (`DOCUSIGN_ACCESS_TOKEN`), discovers
the account, lists templates, and for each writes a converter-shaped JSON
(`recipients` + `documents[].documentBase64`) plus
`docusign-template-manifest.json`. Add `--include-pdf` to also save raw PDFs for
the fallback path. Review the manifest with the developer.

### Step 2: Import the JSON to Anvil

Run the bundled `scripts/import-docusign-json.ts`:

```bash
cp scripts/import-docusign-json.ts ./scripts/
npx ts-node scripts/import-docusign-json.ts --dir ./migrated-templates
```

It uploads each JSON to `createCast` as `application/json`; Anvil's converter
rebuilds the Cast with fields, coordinates, types, and signer roles. It writes
`anvil-import-manifest.json` with each new `castEid`.

**Fallback (Path B):** if a template doesn't convert cleanly, use the raw PDF
(`--include-pdf`) with the `anvil-document-sdk` plugin's
`scripts/migrate-pdfs-to-anvil.ts` (Document AI field detection).

### Step 3: Verify, map roles, and publish

- Verify a converted template with `cast(eid) { config }` (see `api-mapping.md`).
- Record the role → signer-ID mapping (DocuSign `roleName` → Anvil signer id).
- Open each template in the Anvil dashboard, confirm field tagging and signer
  assignments, and **publish** it (unpublished templates can't be used).

### Step 4: ID mapping + database migration

Combine both manifests into `template-id-mapping.json` (DocuSign templateId → Anvil
castEid). Then generate a DB migration that adds Anvil EID columns (`cast_eid`,
`etch_packet_eid`) alongside the existing DocuSign columns and populates them from
the mapping. **Detect the developer's migration framework** (Prisma / Knex /
Sequelize / TypeORM / raw SQL) and match it.

**The developer runs the migration** — do not run it automatically.

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] templates** from DocuSign to `./migrated-templates/`
- **Imported [N] templates** to Anvil — `castEid`s are in `anvil-import-manifest.json`
- **Generated a DB migration** at [path] mapping old template IDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file, working through the Phase 1 integration
points. Reference the `anvil-document-sdk` skill for Anvil patterns.

### Replace client initialization

Replace the DocuSign `ApiClient` + JWT/token exchange + account discovery with a
single `new Anvil({ apiKey })`. See `references/api-mapping.md`.

### Rewrite envelope creation

Map each `createEnvelope` (with `templateId` + `templateRoles`) to
`createEtchPacket`:
- `templateId` → `files[].castEid` (new IDs from Phase 4)
- `templateRoles[].roleName` → `signers[].id`
- `templateRoles[].name/email` → `signers[].name/email`
- `templateRoles[].routingOrder` → `signers[].routingOrder`
- `templateRoles[].tabs.*.value` → `data.payloads.{fileId}.data`
- `emailSubject`/`emailBlurb` → `signatureEmailSubject`/`signatureEmailBody`
- `status: 'created'` → `isDraft: true`

### Rewrite embedded signing

Replace `clientUserId` + `createRecipientView` with `signerType: 'embedded'` +
`generateEtchSignURL` + `AnvilEmbedFrame`. Map `returnUrl?event=` handling to the
frame's `onEvent` (`signerComplete` / `signerError`).

### Rewrite webhook handlers

Map DocuSign Connect events to Anvil webhook events:
- `recipient-completed` → `signerComplete`
- `envelope-completed` → `etchPacketComplete`
- Remove `X-DocuSign-Signature-1` HMAC verification; use Anvil's webhook
  verification instead. Register webhooks with `createWebhookAction`.

### Update environment variables

- Replace all `DOCUSIGN_*` vars with `ANVIL_API_KEY`
- Remove JWT/account-discovery vars (`DOCUSIGN_USER_ID`, `DOCUSIGN_PRIVATE_KEY`,
  `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URI`, HMAC key)
- Update `.env.example`

### Update database references

- `docusign_template_id` → `cast_eid`
- `envelope_id` → `etch_packet_eid`
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced SDK:** `docusign-esign` → `@anvilco/anvil` in [N] files
- **Rewrote [N] envelope calls** to `createEtchPacket`
- **Rewrote embedded signing** to `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events
- **Updated environment variables** and database references

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 6: Verification

Guide the developer through verifying the migration end-to-end.

### Test mode

**"Set `isTest: true` on your Etch packets — test packets are watermarked and
don't count against your plan. Use a development API key for testing."**

### Verification checklist

Walk each integration point from Phase 1:

1. **Templates** — for each migrated template: confirm it's published; verify
   field aliases match your data model; run a `fillPDF` to confirm data fills.
2. **Signature flows** — for each path: create a test packet with `isTest: true`;
   if embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based,
   verify the email arrives; complete a test signing.
3. **Webhooks** — confirm each webhook is registered; trigger a test event; verify
   the handler runs and document download works on completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm
   the signing certificate is included and stored.

### Clean up

Once the developer confirms everything works:

1. **Remove the DocuSign SDK:**
   ```bash
   npm uninstall docusign-esign
   ```
2. **Remove DocuSign environment variables** from `.env`, `.env.example`, and
   deployment configs.
3. **Remove old database columns** (optional) — ask: **"Generate a migration to
   drop the old DocuSign columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-docusign-templates.ts`, `scripts/import-docusign-json.ts`,
   `./migrated-templates/`, `template-id-mapping.json`.
5. **Final check:** search the codebase once more for stray DocuSign references.

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
- DocuSign eSignature REST API: https://developers.docusign.com/docs/esign-rest-api/reference/
