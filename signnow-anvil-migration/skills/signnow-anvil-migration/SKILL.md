---
name: signnow-anvil-migration
description: >
  Migrate existing signNow (airSlate SignNow) e-signature integrations to Anvil Etch
  E-Sign. Use this skill when a developer mentions migrating from signNow, airSlate
  SignNow, @signnow/api-client, the signnow npm package, the signNow REST API,
  api.signnow.com, field invites, embedded invites, event subscriptions, or wants to
  replace their signNow integration with Anvil. Also trigger when someone mentions
  switching e-signature providers from signNow to Anvil, signNow alternatives, signNow
  replacement, converting signNow templates to Anvil, or signNow-to-Anvil migration.
---

# signNow → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing signNow (airSlate SignNow)
e-signature integration to Anvil Etch E-Sign, preserving all existing
functionality. Your job is to discover what they have, map it to Anvil equivalents,
migrate their templates, rewrite code, and verify everything works.

**What's different about signNow:** two things shape the migration. (1) **Two-step
auth** — signNow exchanges a Basic client credential for a Bearer access token
(`POST /oauth2/token`), then sends that token on every other call; Anvil uses one
long-lived API key, so the whole handshake disappears. (2) **Multi-call sends** —
signNow copies a template, prefills it, then sends a field invite as separate calls;
Anvil collapses that into a single `createEtchPacket`. Templates are **flat PDFs with
positioned fields**, so they migrate via PDF download + Anvil Document AI (Phase 4).

**Important:** For all Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, PDF filling, downloads), reference the
`anvil-document-sdk` skill rather than reimplementing guidance here. This skill
focuses on the signNow-specific discovery, mapping, and migration steps.

---

## Before you start: offer a migration overview

When the developer is **first** starting the migration — before discovery — ask:
**"Want a quick overview of how a signNow → Anvil migration works — the terminology
differences and how the API calls line up?"**

If yes, share the two-paragraph summary below (keep it to these two paragraphs —
don't expand it). Write to a technical reader who's comfortable with code. If they'd
rather dive in, skip to Phase 1.

> **Terminology.** Your signNow *document* is an Anvil *Etch packet*
> (`createEtchPacket` → `etchPacketEid`); a *template* is a *Cast* (`castEid`); a
> field *role* ("Signer 1") is an Anvil *signer* with an arbitrary `id`; positioned
> *fields/elements* (signature, text, checkbox, radiobutton, dropdown, each with
> `x`/`y`/`page_number`/`width`/`height`) become typed *fields* whose names map to
> Anvil `aliasId`s; *prefill-texts* become a `data.payloads` prefill; a field
> invite's `order` becomes `routingOrder`; and an *embedded invite* becomes an
> embedded signer (`signerType: 'embedded'`). One `@anvilco/anvil` client with a
> single `ANVIL_API_KEY` replaces signNow's Basic-credential → Bearer-token two-step
> and its split endpoints.
>
> **API sequencing.** Where you `POST /template/{id}/copy` to spawn a document, then
> `PUT /v2/documents/{id}/prefill-texts`, then `POST /document/{id}/invite` (a
> role-based field invite with `to[].order`) — or create an embedded invite and its
> `/link` for captive signing — then subscribe with `POST /api/v2/events` and
> `GET /document/{id}/download` on completion: Anvil collapses that to one
> `createEtchPacket` (files by `castEid`, each signer carrying its own `fields[]`,
> plus `data.payloads`; `isTest: true` while developing), then `generateEtchSignURL`
> + `AnvilEmbedFrame` for embedded signers, `createWebhookAction` for
> `signerComplete`/`etchPacketComplete` (signNow's `document.complete` →
> `etchPacketComplete`), and `downloadDocuments` (signed PDFs + certificate in one
> zip) on completion. Templates migrate by downloading each template's PDF and
> letting Anvil Document AI re-detect fields (a dynamic-doc option exists for
> content-based templates).

For the full vocabulary, see `references/terminology.md`; for the full API mapping
with before/after code, `references/api-mapping.md`.

---

## Phase 1: Discovery

Before making changes, scan the codebase for every signNow integration point.
Present a complete findings summary before proceeding.

### Search for imports and packages

```
@signnow/api-client
signnow
SignNow
signnow-node-sdk
oauth2.requestToken
```

Check `package.json` / lockfiles for `@signnow/api-client` (or the legacy `signnow`
package, or a direct HTTP client hitting signNow).

### Search for API endpoints

```
api.signnow.com
api.eval-signnow.com
/oauth2/token
/template/
/document/
/v2/documents/
/api/v2/events
```

### Search for environment variables

```
SIGNNOW_API_TOKEN
SIGNNOW_ACCESS_TOKEN
SIGNNOW_CLIENT_ID
SIGNNOW_CLIENT_SECRET
SIGNNOW_BASIC_TOKEN
SIGNNOW_USERNAME
SIGNNOW_PASSWORD
SIGNNOW_API_KEY
SIGN_NOW_*
```

Check `.env`, `.env.*`, and deployment configs (Docker, Kubernetes, CI/CD).

### Search for SDK / API usage patterns

```
requestToken            (OAuth token exchange)
document.create         (upload document)
template.create
template.copy           (create document from template)
documentInvite.create   (field invite)
fieldInvite
embedded-invites
prefill-texts
document.download
document.get
```

### Search for multi-tenant / on-behalf usage

An authorization-code grant, or a password grant run per user, means the integration
serves more than one signNow account. Anvil supports this too, but the shape of the
port depends on which pattern is in use, so find it in discovery — not in code
migration:

```
grant_type=authorization_code
oauth2/authorize
refresh_token
SIGNNOW_USERNAME / SIGNNOW_PASSWORD   (password grant, possibly per tenant)
tenantId / accountId                  (per-tenant signNow credentials in your DB)
```

Check whether the app stores per-tenant signNow tokens or user credentials, whether
it mints a token per tenant at send time, and whether one event subscription covers
many accounts. If any of this is present, flag it for the Phase 2 architecture
decision (OAuth app vs. child org per tenant vs. one org with per-packet `replyTo`).

### Search for webhook / event-subscription handlers

```
document.complete
document.update
document.create
invite.create
invite.update
event_subscription
/api/v2/events
callback
```

Also look for any webhook signature verification (a shared secret / HMAC / JWT on
the callback).

### Search for database references

```
signnow_document_id
signnow_template_id
document_id
template_id
invite_id
role_id
signing_link
```

Search migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw
SQL), and model files.

### Present findings

Present a structured summary:

1. **Packages** — installed signNow packages + versions
2. **SDK usage** — each file and the signNow calls it makes
3. **API endpoints** — any direct HTTP calls
4. **Environment variables** — which are referenced and where (note the OAuth
   client id/secret + token vars — they all collapse to one Anvil key)
5. **Webhook handlers** — event-subscription routes + events handled
6. **Database references** — tables/columns storing signNow IDs
7. **Templates used** — template IDs hardcoded or in config
8. **Multi-tenancy** — whether the app sends on behalf of other accounts/tenants
   (authorization-code grant, per-tenant tokens, a password grant run per user)

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once discovery is confirmed, map their integration to Anvil.

### Load the mapping reference

Read `references/terminology.md` for the vocabulary map (signNow term → Anvil term),
then `references/api-mapping.md` for the complete signNow → Anvil mapping (two-step
auth → single key, template copy + prefill + field invite → `createEtchPacket`,
embedded signing, event subscriptions, templates, fields, downloads, and how to
list/read Anvil templates).

### Surface feature parity gaps

Read `references/feature-parity.md`. For each gap that applies to their integration,
**explicitly ask the developer how they want to handle it** — never silently drop a
feature. Pay special attention to:
- **Two-step OAuth** — the client id/secret + token exchange collapse to one key.
- **Multi-call send** — copy → prefill → invite collapses to one `createEtchPacket`.
- **Signer authentication** (phone/SMS/password) and **expiration/reminders** — these
  become app-level in Anvil.

Present the mapping summary:
1. **Direct equivalents** — most things (send, signers, routing, embedded, fields)
2. **Gaps with workarounds** — CC recipients, reminders/expiration, decline, bulk
   send, signer auth
3. **Gaps needing decisions** — per-signer webhook precision, and multi-tenant /
   on-behalf architecture (Anvil OAuth app vs. a child org per tenant vs. one org
   with per-packet `replyTo` — supported, but the choice shapes credential storage
   and webhook routing)

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

### Keep signNow credentials temporarily

**Do not remove** the signNow credentials or SDK yet — they're needed to export
templates in Phase 4. Tell the developer:

**"I'm keeping your signNow credentials in place for now — we need them to export
your existing templates. We'll remove them in Phase 6 after verification. If you have
sandbox (eval) credentials, we'll use those for the export so we don't touch
production."**

---

## Phase 4: Template Migration

Read `references/template-migration.md` for the full process. signNow templates are
**flat PDFs with positioned fields**, so the default is **PDF + Anvil Document AI**;
a **dynamic-doc** target is available for content-based templates (choose per
template).

### Step 1: Export templates from signNow

Copy and run the bundled `scripts/export-signnow-templates.ts`:

```bash
cp scripts/export-signnow-templates.ts ./scripts/
npx ts-node scripts/export-signnow-templates.ts --output-dir ./migrated-templates
```

It obtains a Bearer token (from a Basic client credential + password grant, or from
a token you pass), finds the **Templates** folder, lists its templates, and for each
reads roles/fields (`GET /document/{id}`) and downloads the flattened PDF
(`GET /document/{id}/download?type=collapsed`), writing the PDFs + a
`signnow-template-manifest.json`. Review the manifest with the developer.

### Step 2: Upload PDFs to Anvil

Use the `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts` to upload
the exported PDFs (optionally with `--schema` to seed field aliases, and Document AI
field detection). It writes `anvil-migration-manifest.json` with each new `castEid`.

**Dynamic-doc target (optional):** for content-heavy templates, rebuild as a dynamic
doc (create → `updateCast` content tree → publish) instead — see
`template-migration.md` for the tiered rule and authoring flow.

### Step 3: Map roles/fields, ID mapping, DB migration

- Record the role → signer-ID mapping (signNow role "Signer 1" → Anvil signer id
  `signer1`) and field → alias mapping.
- Combine both manifests into `template-id-mapping.json` (signNow templateId → Anvil
  `castEid`).
- Generate a DB migration that adds Anvil EID columns (`cast_eid`, `etch_packet_eid`)
  alongside the existing signNow columns and populates them from the mapping.
  **Detect the developer's migration framework** (Prisma / Knex / Sequelize /
  TypeORM / raw SQL) and match it. **The developer runs it** — do not run it
  automatically.

### Step 4: Publish + verify

Open each template in the Anvil dashboard, confirm field tagging + signer
assignments, and **publish** it (unpublished templates error). Verify with
`cast(eid) { config }` (see `api-mapping.md`).

### Commit checkpoint

**"Phase 4 is complete:**
- **Exported [N] templates** from signNow to `./migrated-templates/`
- **Uploaded [N] templates** to Anvil — `castEid`s are in `anvil-migration-manifest.json`
- **Generated a DB migration** at [path] mapping old template IDs to Anvil EIDs

**Would you like to commit now, or review anything first?"** Wait for the response.

---

## Phase 5: Code Migration

Rewrite the application code file by file, working through the Phase 1 integration
points. Reference the `anvil-document-sdk` skill for Anvil patterns.

### Replace client initialization

Replace the signNow two-step OAuth (Basic client credential → `POST /oauth2/token` →
Bearer token, plus refresh handling) with a single `new Anvil({ apiKey })`. See
`references/api-mapping.md`. **Delete the token-exchange and refresh logic.**

If Phase 2 chose a multi-tenant path, the key is resolved **per tenant** rather than
read from one env var — an Anvil OAuth token for the tenant's own organization, or
that tenant's child-org API key looked up at send time. Construct the client per
request instead of once at module load.

### Rewrite the send flow

Collapse the signNow **copy → prefill → field invite** sequence into a single
`createEtchPacket`:
- `POST /template/{id}/copy` (templateId) → `files[].castEid` (new IDs from Phase 4)
- invite `to[].role` → `signers[].id`; `to[].email` → `signers[].email`
- invite `to[].order` → `signers[].routingOrder`
- `prefill-texts` values → `data.payloads.{fileId}.data` (keyed by field alias)
- invite `subject` / `message` → `signatureEmailSubject` / `signatureEmailBody`
- (save as draft) → `isDraft: true`
- **Delete the separate copy and prefill calls** — one call does all three.

### Rewrite embedded signing

Replace the embedded-invite + `/link` two-call flow with `signerType: 'embedded'` +
`generateEtchSignURL` + `AnvilEmbedFrame`. Map post-signing handling to the frame's
`onEvent` (`signerComplete` / `signerError`).

### Rewrite webhook handlers

Map signNow event subscriptions to Anvil webhook events:
- `document.complete` → `etchPacketComplete`
- `document.update` / `invite.update` → `signerComplete` (closest per-signer analog —
  confirm the exact event you handled; see `api-mapping.md`)
- Remove signNow's callback registration (`POST /api/v2/events`) and any callback
  signature verification; register with `createWebhookAction` and use Anvil's webhook
  verification instead.

### Update environment variables

- Replace all `SIGNNOW_*` vars (client id/secret, tokens, username/password) with
  `ANVIL_API_KEY`
- If OAuth was used to act on behalf of other accounts (not just as this account's
  auth mechanism), the client id/secret are replaced rather than dropped — by the
  credentials for the multi-tenant path chosen in Phase 2: an Anvil OAuth app's
  client ID/secret, or per-tenant child-org API keys (stored encrypted, looked up
  per tenant at send time)
- Remove token-refresh / eval-host config
- Replace eval-host usage with `isTest: true`
- Update `.env.example`

### Update database references

- `signnow_template_id` → `cast_eid`
- `signnow_document_id` → `etch_packet_eid`
- Update queries, models, and type definitions

### Commit checkpoint

**"Phase 5 is complete:**
- **Replaced SDK:** `@signnow/api-client` → `@anvilco/anvil` in [N] files
- **Collapsed [N] send flows** (copy → prefill → invite) into a single `createEtchPacket`
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
   aliases match your data model; run a `fillPDF` to confirm data fills.
2. **Signature flows** — for each path: create a test packet with `isTest: true`; if
   embedded, verify `AnvilEmbedFrame` loads and signing works; if email-based, verify
   the email arrives; complete a test signing.
3. **Webhooks** — confirm each webhook is registered; trigger a test event; verify
   the handler runs and document download works on completion.
4. **Downloads** — download completed documents via `downloadDocuments`; confirm the
   signing certificate is included (Anvil bundles it into the zip — no separate audit
   download) and stored.

### Clean up

Once the developer confirms everything works:

1. **Remove the signNow SDK:**
   ```bash
   npm uninstall @signnow/api-client
   ```
2. **Remove signNow environment variables** from `.env`, `.env.example`, and
   deployment configs (client id/secret, tokens, username/password).
3. **Remove old database columns** (optional) — ask: **"Generate a migration to drop
   the old signNow columns, or keep them as a backup for now?"**
4. **Remove migration scripts and manifests:**
   `scripts/export-signnow-templates.ts`, `scripts/migrate-pdfs-to-anvil.ts` (if
   copied), `./migrated-templates/`, `template-id-mapping.json`,
   `signnow-template-manifest.json`, `anvil-migration-manifest.json`.
5. **Final check:** search the codebase once more for stray signNow references.

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
- signNow API docs: https://docs.signnow.com/docs/signnow/welcome
- signNow Node SDK: https://github.com/signnow/SignNowNodeSDK
