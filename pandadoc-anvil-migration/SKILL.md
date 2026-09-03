---
name: pandadoc-anvil-migration
description: >
  Migrate existing PandaDoc e-signature integrations to Anvil Etch E-Sign.
  Use this skill when a developer mentions migrating from PandaDoc, pandadoc-node-client,
  the PandaDoc API, document templates with roles/fields/tokens, PandaDoc signing
  sessions, or wants to replace their PandaDoc integration with Anvil. Also trigger
  when someone mentions switching e-signature providers from PandaDoc to Anvil,
  PandaDoc alternatives, PandaDoc replacement, converting PandaDoc templates to Anvil,
  or PandaDoc-to-Anvil migration.
---

# PandaDoc → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing PandaDoc integration to Anvil
Etch E-Sign, preserving all existing functionality. Your job is to discover what
they have, map it to Anvil equivalents, migrate their templates, rewrite code, and
verify everything works.

**What's different about PandaDoc:** its templates are **block/content-based** (rich
text + merge **tokens** + **fields** assigned to roles), not flat PDFs with
positioned tabs. There is no flat-PDF export for a template, so template migration
offers two targets — a structure-preserving **dynamic doc** or a simpler **PDF +
Document AI** pass (Phase 4).

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the PandaDoc-specific discovery, mapping, and migration steps.

---

## Before you start: offer a migration overview

When the developer is **first** starting the migration — before discovery — ask:
**"Want a quick overview of how a PandaDoc → Anvil migration works — the terminology
differences and how the API calls line up?"**

If yes, share the two-paragraph summary below (keep it to these two paragraphs —
don't expand it). Write to a technical reader who's comfortable with code. If they'd
rather dive in, skip to Phase 1.

> **Terminology.** Your PandaDoc *document* is an Anvil *Etch packet*
> (`createEtchPacket` → `etchPacketEid`); a *template* is a *Cast* (`castEid`) or a
> *dynamic doc*; a *role* is an Anvil *signer* with an arbitrary `id`; *fields* are
> signer-assigned *field aliases*; and — the one that trips people up — *tokens*
> (`{{merge}}` variables) become *fill data* (`data.payloads`), **not** signer
> fields. `send silent:false/true` maps to `signerType: 'email'`/`'embedded'`, and a
> *signing session* becomes `generateEtchSignURL`. One `@anvilco/anvil` client with a
> single `ANVIL_API_KEY` replaces the `API-Key` SDK.
>
> **API sequencing.** PandaDoc's create → poll → send is asynchronous: `POST /documents`
> (`template_uuid`), poll until `document.draft`, then `POST /send`, then a `/session`
> for embedded signing. Anvil collapses all of that into one **synchronous**
> `createEtchPacket` (files by `castEid`, each signer carrying its own `fields[]`,
> plus `data.payloads` for fields *and* former tokens; `isTest: true` while
> developing) — **drop the poll loop** — then `generateEtchSignURL` for embedded
> signers, `createWebhookAction` for `signerComplete`/`etchPacketComplete` (PandaDoc's
> `recipient_completed` / `document_state_changed`→`document.completed`), and
> `downloadDocuments` on completion. Templates have no flat-PDF export, so each one
> migrates to either a structure-preserving **dynamic doc** or a rendered **PDF +
> Document AI**, chosen per template.

For the full vocabulary, see `references/terminology.md`; for the full API mapping
with before/after code, `references/api-mapping.md`.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every PandaDoc integration point.
Present a complete findings summary before proceeding.

### Search for imports and packages

```
pandadoc-node-client
pandadoc
DocumentsApi
TemplatesApi
Configuration
API-Key
```

Check `package.json` / lockfiles for `pandadoc-node-client` (or a direct HTTP
client hitting PandaDoc).

### Search for API endpoints

```
api.pandadoc.com
api.pandadoc.com/public/v1
app.pandadoc.com/s/
oauth2/access_token
```

### Search for environment variables

```
PANDADOC_API_KEY
PANDADOC_SANDBOX_API_KEY
PANDADOC_WEBHOOK_KEY
PANDADOC_SHARED_KEY
PANDADOC_CLIENT_ID
PANDADOC_CLIENT_SECRET
```

Check `.env`, `.env.*`, and deployment configs.

### Search for SDK / API usage patterns

```
createDocument
createDocumentFromTemplate
templateUuid
template_uuid
sendDocument
createDocumentLink        (embedded signing session)
statusDocument
detailsDocument
downloadDocument
downloadProtectedDocument
listDocuments
listTemplates
templateDetails
createDocumentAttachment
```

### Search for multi-tenant / on-behalf usage

An OAuth2 authorization-code flow, multiple workspaces, or per-tenant API keys mean
the integration serves more than one PandaDoc account. Anvil supports this too, but
the shape of the port depends on which pattern is in use, so find it in discovery —
not in code migration:

```
oauth2/access_token     (PandaDoc token exchange)
PANDADOC_CLIENT_ID
PANDADOC_CLIENT_SECRET
refresh_token
workspace / workspace_id
sender                  (send-as on document create)
tenantId / accountId    (per-tenant PandaDoc credentials in your DB or config)
```

Check whether the app stores per-tenant PandaDoc tokens or keys, whether it selects a
workspace per request, and whether webhook subscriptions are registered per tenant. If
any of this is present, flag it for the Phase 2 architecture decision (OAuth app vs.
child org per tenant vs. one org with per-packet `replyTo`).

### Search for webhook handlers

```
document_state_changed
document_completed_pdf_ready
recipient_completed
document_updated
document.completed
document.draft
x-pd-signature
webhook-subscriptions
```

Also look for HMAC verification (`x-pd-signature`, `createHmac`,
`PANDADOC_WEBHOOK_KEY`/`PANDADOC_SHARED_KEY`).

### Search for database references

```
pandadoc_document_id
document_uuid
template_uuid
pandadoc_template_id
recipient_id
session_id
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — installed PandaDoc packages + versions
2. **SDK usage** — each file and the PandaDoc calls it makes
3. **API endpoints** — any direct HTTP calls
4. **Environment variables** — which are referenced and where
5. **Webhook handlers** — subscription routes + events handled
6. **Database references** — tables/columns storing PandaDoc IDs
7. **Templates used** — template UUIDs hardcoded or in config
8. **Multi-tenancy** — whether the app sends on behalf of other accounts/tenants
   (per-tenant OAuth tokens or API keys, workspaces, the `sender` field)

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/terminology.md` for the vocabulary map (PandaDoc term → Anvil
term), then `references/api-mapping.md` for the complete PandaDoc → Anvil mapping (client
init, the roles/fields/tokens model, document create → `createEtchPacket`, embedded
sessions, webhooks, templates, auth, downloads, and how to list/read Anvil
templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies, **explicitly ask the
developer how they want to handle it** — never silently drop a feature. Pay special
attention to:
- **Tokens vs fields** — tokens become fill data, not signer fields.
- **Block/content templates** — the dynamic-doc vs PDF+Document-AI decision (Phase 4).
- **Pricing tables / conditional content** — partial support; confirm what's needed.
- **Multi-tenant / on-behalf architecture** — if discovery found OAuth2, workspaces,
  or per-tenant keys, decide now between an Anvil OAuth app, a child org per tenant,
  and one org with per-packet `replyTo`. It is supported either way, but the choice
  shapes credential storage and webhook routing.

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

### Keep the PandaDoc key temporarily

**Do not remove** the PandaDoc key or SDK yet — they're needed to export templates
in Phase 4. Tell the developer:

**"I'm keeping your PandaDoc key in place for now — we need it to export your
existing templates. We'll remove it in Phase 6 after verification. If you have a
sandbox key, we'll use that for the export so we don't touch production."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. Because PandaDoc has
no flat-PDF export, you choose a **target per template**.

### Step 1: Export from PandaDoc

Copy and run the bundled `scripts/export-pandadoc-templates.ts`:

```bash
cp scripts/export-pandadoc-templates.ts ./scripts/
npx ts-node scripts/export-pandadoc-templates.ts --output-dir ./migrated-templates
```

It reads each template's roles/fields/tokens, renders a base PDF (by instantiating a
throwaway document — never sent, deleted afterward unless `--keep-docs`), captures
field geometry where available, and writes `pandadoc-template-manifest.json`. Use a
sandbox key if you'd rather not touch production. Review the manifest with the
developer.

### Step 2: Choose a target per template

Present the tiered rule from `template-migration.md`:

- **Dynamic doc (higher fidelity)** — content-heavy, reflowing text, real tables,
  repeating line items, or templates that should stay editable in Anvil. Maps
  blocks → content nodes, tokens → inline field nodes, fields → typed field nodes.
  Authored via create → `updateCast` (content tree) → publish. Tradeoff: you
  generate Anvil's internal content-tree JSON.
- **PDF + Document AI (simpler)** — simple/fixed layouts, PDF-origin templates, or
  the least-maintenance path. Upload the base PDF and let Document AI detect fields.

Ask per template (or in bulk): **"For this template, does structural fidelity and
editability matter more (dynamic doc), or is a fixed-layout PDF fine (simpler)?"**

### Step 3: Import

- **Dynamic doc:** build the content tree from the manifest and run create →
  `updateCast` → `publishCast` (see `template-migration.md` for the exact calls).
- **PDF + Document AI:** upload the base PDFs with the `anvil-document-sdk` plugin's
  `scripts/migrate-pdfs-to-anvil.ts`, then re-tag fields.

### Step 4: Map roles/fields/tokens, ID mapping, DB migration

- Record role → signer-ID, field → alias, and token → data-key mappings.
- Combine into `template-id-mapping.json` (PandaDoc `template_uuid` → Anvil `castEid`).
- Generate a DB migration that adds `cast_eid` / `etch_packet_eid` alongside the
  existing PandaDoc columns and populates them from the mapping. **Detect the
  developer's migration framework** and match it. **The developer runs it.**

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] templates** from PandaDoc to `./migrated-templates/`
- **Imported [N] templates** to Anvil ([X] as dynamic docs, [Y] as PDFs)
- **Generated a DB migration** at [path] mapping old template UUIDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file. Reference the `anvil-document-sdk` skill
for Anvil patterns.

### Replace client initialization

Replace the PandaDoc `Configuration` + `DocumentsApi` with a single
`new Anvil({ apiKey })`.

If Phase 2 chose a multi-tenant path, the key is resolved **per tenant** rather than
read from one env var — an Anvil OAuth token for the tenant's own organization, or
that tenant's child-org API key looked up at send time. Construct the client per
request instead of once at module load.

### Rewrite document creation + send

Collapse the PandaDoc **create → poll → send** flow into a single
`createEtchPacket`:
- `template_uuid` → `files[].castEid`
- `recipients[].role` → `signers[].id`; `first_name`+`last_name` → `name`
- `recipients[].signing_order` → `signers[].routingOrder`
- `fields{}` and `tokens[]` → `data.payloads.{fileId}.data`
- send `silent: false` → `signerType: 'email'`; `silent: true` → `signerType: 'embedded'`
- **Delete the `document.draft` poll loop.**

### Rewrite embedded signing

Replace `createDocumentLink` (session) + `app.pandadoc.com/s/{id}` with
`signerType: 'embedded'` + `generateEtchSignURL` + `AnvilEmbedFrame`.

### Rewrite webhook handlers

Map PandaDoc events to Anvil events:
- `recipient_completed` → `signerComplete`
- `document_state_changed` (`status == "document.completed"`) and
  `document_completed_pdf_ready` → `etchPacketComplete`
- Remove `x-pd-signature` HMAC verification; use Anvil's webhook verification.
  Register webhooks with `createWebhookAction`.

### Update environment variables

- Replace `PANDADOC_API_KEY` (and sandbox/webhook keys) with `ANVIL_API_KEY`
- Replace sandbox-key usage with `isTest: true`
- OAuth vars (`PANDADOC_CLIENT_ID`, `PANDADOC_CLIENT_SECRET`): if OAuth was only an
  auth mechanism for a single account, drop them. If it was used to act on behalf of
  other accounts, replace them with the credentials for the multi-tenant path chosen
  in Phase 2 — an Anvil OAuth app's client ID/secret, or per-tenant child-org API
  keys (stored encrypted, looked up per tenant at send time)
- Update `.env.example`

### Update database references

- `pandadoc_template_id` / `template_uuid` → `cast_eid`
- `pandadoc_document_id` / `document_uuid` → `etch_packet_eid`
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced SDK:** `pandadoc-node-client` → `@anvilco/anvil` in [N] files
- **Rewrote [N] document flows** to a single `createEtchPacket` (dropped the poll)
- **Rewrote embedded signing** to `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events
- **Updated environment variables** and database references

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 6: Verification

Guide the developer through verifying the migration end-to-end.

### Test mode

**"Set `isTest: true` on your Etch packets — test packets are watermarked and don't
count against your plan. Use a development API key."**

### Verification checklist

1. **Templates** — for each migrated template: confirm it's published; verify field
   aliases match your data model; run a `fillPDF` to confirm data fills (dynamic docs
   and PDFs both fill via the same `data` mechanism).
2. **Signature flows** — for each path: create a test packet with `isTest: true`;
   if embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based,
   verify the email arrives; complete a test signing.
3. **Webhooks** — confirm each webhook is registered; trigger a test event; verify
   the handler runs and document download works on completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm the
   signing certificate is included and stored.

### Clean up

Once the developer confirms everything works:

1. **Remove the PandaDoc SDK:**
   ```bash
   npm uninstall pandadoc-node-client
   ```
2. **Remove PandaDoc environment variables** from `.env`, `.env.example`, and deploy
   configs.
3. **Remove old database columns** (optional) — ask: **"Generate a migration to drop
   the old PandaDoc columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-pandadoc-templates.ts`, `./migrated-templates/`,
   `template-id-mapping.json`.
5. **Final check:** search the codebase once more for stray PandaDoc references.

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
- PandaDoc API reference: https://developers.pandadoc.com/reference
