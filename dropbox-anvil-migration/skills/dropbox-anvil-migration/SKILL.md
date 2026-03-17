---
name: dropbox-anvil-migration
description: >
  Migrate existing DropboxSign or HelloSign e-signature integrations to Anvil Etch E-Sign.
  Use this skill when a developer mentions migrating from DropboxSign, HelloSign, Dropbox Sign,
  hellosign-sdk, @dropbox/sign, or wants to replace their DropboxSign/HelloSign integration with
  Anvil. Also trigger when someone mentions switching e-signature providers from DropboxSign to Anvil,
  or asks about DropboxSign alternatives, HelloSign replacement, or DropboxSign-to-Anvil migration.
---

# DropboxSign → Anvil Etch E-Sign Migration Skill

You are helping a developer migrate their existing DropboxSign (formerly HelloSign) e-signature integration to Anvil Etch E-Sign. This is a multi-phase migration that preserves all existing functionality while moving to Anvil's platform. Your job is to discover what they have, map it to Anvil equivalents, migrate templates and data, rewrite code, and verify everything works.

**Important:** For all Anvil implementation patterns (client setup, Etch packets, embedded signing, webhooks, PDF filling, etc.), reference the `anvil-document-sdk` skill rather than reimplementing guidance from scratch. This skill focuses on the DropboxSign-specific discovery, mapping, and migration steps.

---

## Phase 1: Discovery

Before making any changes, scan the developer's codebase to find every DropboxSign/HelloSign integration point. Run these searches and present a complete findings summary before proceeding.

### Search for imports and packages

Search the codebase for these patterns:

```
hellosign-sdk
@dropbox/sign
hellosign
dropboxsign
dropbox-sign
HelloSignSDK
SignatureRequestApi
TemplateApi
EmbeddedApi
AccountApi
BulkSendJobApi
UnclaimedDraftApi
```

Check `package.json` (and `package-lock.json` / `yarn.lock`) for DropboxSign/HelloSign dependencies.

### Search for API endpoints

```
api.hellosign.com
api.dropboxsign.com
```

### Search for environment variables

```
HELLOSIGN_API_KEY
DROPBOX_SIGN_API_KEY
HELLOSIGN_CLIENT_ID
DROPBOX_SIGN_CLIENT_ID
HELLOSIGN_API_URL
DROPBOX_SIGN_API_URL
```

Check `.env`, `.env.example`, `.env.local`, `.env.production`, and any environment configuration files (e.g., Docker compose, Kubernetes manifests, CI/CD configs).

### Search for SDK usage patterns

```
signatureRequestSend
signatureRequestSendWithTemplate
signatureRequestCreateEmbedded
signatureRequestCreateEmbeddedWithTemplate
embeddedSignUrl
templateList
templateGet
templateFiles
templateCreateEmbeddedDraft
signatureRequestGet
signatureRequestList
signatureRequestCancel
signatureRequestFiles
```

### Search for webhook handlers

Look for routes or handlers that process DropboxSign webhook events:

```
signature_request_viewed
signature_request_signed
signature_request_sent
signature_request_all_signed_and_complete
signature_request_downloadable
signature_request_declined
signature_request_invalid
signature_request_remind
signature_request_expired
template_created
template_error
account_confirmed
```

Also search for webhook signature verification code (`EventCallbackHelper`, `event_hash`, `HMAC`).

### Search for database references

Look for database columns, tables, or model fields that store DropboxSign/HelloSign IDs:

```
signature_request_id
hellosign_template_id
dropbox_template_id
template_id
signing_url
claim_url
```

Search in migration files, schema definitions (Prisma, Sequelize, TypeORM, Knex, raw SQL), and model files.

### Present findings

After completing all searches, present a structured summary to the developer:

**"Here's what I found in your codebase:"**

1. **Packages:** List installed DropboxSign/HelloSign packages with versions
2. **SDK Usage:** List each file and the DropboxSign API calls it makes (e.g., `src/services/signing.ts` → `signatureRequestSendWithTemplate`, `embeddedSignUrl`)
3. **API Endpoints:** Any direct HTTP calls to DropboxSign APIs
4. **Environment Variables:** Which env vars are referenced and where
5. **Webhook Handlers:** Routes that process DropboxSign events, with the events they handle
6. **Database References:** Tables/columns that store DropboxSign IDs
7. **Templates Used:** Template IDs found hardcoded or in config files

Ask: **"Does this look complete, or are there integration points I missed?"**

---

## Phase 2: API Mapping

Once the developer confirms the discovery is complete, map their existing integration to Anvil equivalents.

### Load the mapping reference

Read `references/api-mapping.md` for the complete DropboxSign → Anvil API mapping. This covers SDK calls, client initialization, signature request fields, embedded signing, webhooks, templates, and authentication.

### Surface feature parity gaps

Read `references/feature-parity.md` for known gaps and workarounds. For each gap that applies to the developer's integration, **explicitly ask the developer how they want to handle it**. Never silently drop a feature.

For example, if their code uses bulk send:
**"Your integration uses DropboxSign's bulk send feature. Anvil doesn't have a built-in bulk send API — the recommended approach is to loop over `createEtchPacket` calls with rate limiting (40 req/s on production keys). Is that acceptable, or do you need a different approach?"**

Present the full mapping summary:
1. **Direct equivalents** — features that map cleanly (most of them)
2. **Gaps with workarounds** — features that need adaptation
3. **Gaps without workarounds** — features that don't have an Anvil equivalent (rare)

Ask: **"Are you comfortable with these mappings? Any concerns before we proceed?"**

---

## Phase 3: Environment Setup

### Anvil API key

Ask: **"Do you already have an Anvil API key? If not, create an account at https://app.useanvil.com/signup and find your API key under Organization Settings > API Settings."**

Once they have the key:

```
ANVIL_API_KEY=<add api key>
```

Add it to their `.env` file. Confirm `.env` is in `.gitignore`.

### Install Anvil SDK

```bash
npm install @anvilco/anvil
```

If their integration uses embedded signing in a React frontend:
```bash
npm install @anvilco/anvil-embed-frame
```

### Keep DropboxSign key temporarily

**Do not remove** the DropboxSign API key or SDK yet. Both are needed during the template migration phase. Tell the developer:

**"I'm keeping your DropboxSign API key and SDK in place for now — we need them to download your existing templates. We'll remove them in Phase 6 after everything is verified."**

---

## Phase 4: Template Migration

This phase has three distinct steps. Read `references/template-migration.md` for the full process.

### Step 1: Download templates from DropboxSign

Use the bundled `scripts/migrate-dropboxsign-templates.ts` to download all templates from DropboxSign as PDFs.

1. Copy the script into the developer's project:
   ```bash
   cp scripts/migrate-dropboxsign-templates.ts ./scripts/
   ```

2. Run the script:
   ```bash
   npx ts-node scripts/migrate-dropboxsign-templates.ts --output-dir ./migrated-templates
   ```

   Or for specific templates only:
   ```bash
   npx ts-node scripts/migrate-dropboxsign-templates.ts \
     --output-dir ./migrated-templates \
     --template-ids "abc123,def456"
   ```

   The script:
   - Uses the `DROPBOX_SIGN_API_KEY` env var
   - Lists all templates via the DropboxSign REST API
   - Downloads each template as a PDF
   - Generates `dropboxsign-template-manifest.json` with metadata (template ID, title, roles, merge fields)
   - Respects rate limits with configurable delay

3. Review the manifest with the developer. Show them how many templates were downloaded and their metadata.

### Step 2: Upload templates to Anvil

Use the `anvil-document-sdk` plugin's bundled `scripts/migrate-pdfs-to-anvil.ts` to upload the downloaded PDFs to Anvil.

1. Ask the developer if they want to extract field aliases from their codebase schema (same process as `anvil-document-sdk` — inspect Prisma models, TypeScript interfaces, etc.)

2. Run the Anvil upload script:
   ```bash
   npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates
   ```

   Or with schema for field alias suggestions:
   ```bash
   npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./migrated-templates --schema ./extracted-schema.json
   ```

3. After upload, create a combined ID mapping from both manifests — map each DropboxSign template ID to its new Anvil `castEid`. Save this as `template-id-mapping.json`:

   ```json
   {
     "mappings": [
       {
         "dropboxSignTemplateId": "abc123...",
         "dropboxSignTitle": "NDA Template",
         "anvilCastEid": "xyz789...",
         "anvilTitle": "NDA Template"
       }
     ]
   }
   ```

4. Remind the developer to open each template in the Anvil dashboard to:
   - Review and adjust field tagging
   - Map roles to signer IDs
   - Publish each template

### Step 3: Database migration

Generate a runnable DB migration script that:
- Creates new columns for Anvil EIDs (e.g., `cast_eid`, `etch_packet_eid`) alongside existing DropboxSign columns
- Populates the new columns using the old → new ID mapping from `template-id-mapping.json`
- Preserves existing DropboxSign columns (they'll be removed after verification in Phase 6)

**Detect the developer's migration framework** by searching for:
- `prisma/migrations/` → Generate a Prisma migration
- `migrations/` with Knex-style files → Generate a Knex migration
- `migrations/` with Sequelize-style files → Generate a Sequelize migration
- TypeORM migration patterns → Generate a TypeORM migration
- If none detected → Generate raw SQL

Generate the migration in the developer's existing format and save it to the appropriate directory.

**Important:** The developer runs the migration themselves — do NOT run it automatically. Tell them:

**"I've generated the database migration at [path]. Please review it and run it when you're ready. It adds Anvil EID columns alongside your existing DropboxSign columns and populates them from the template ID mapping."**

### Commit checkpoint

After all three steps are complete, **pause and check in with the developer**:

**"Phase 4 is complete. Here's what was done:**
- **Downloaded [N] templates** from DropboxSign as PDFs to `./migrated-templates/`
- **Uploaded [N] templates** to Anvil — `castEid` values are in the migration manifest
- **Generated DB migration** at [path] that maps old template IDs to new Anvil EIDs

**Would you like to commit these changes now, or do you want to review anything first?"**

Wait for the developer's response before committing or proceeding.

---

## Phase 5: Code Migration

Now rewrite the application code to use Anvil instead of DropboxSign. Work file by file through the integration points discovered in Phase 1.

For all Anvil implementation patterns, **reference the `anvil-document-sdk` skill** — it has detailed guidance on client setup, `createEtchPacket`, embedded signing, webhooks, document download, and storage.

### Replace SDK initialization

Read `references/api-mapping.md` for the side-by-side initialization code. Replace the DropboxSign client with the Anvil client.

### Rewrite signature request creation

Map each `signatureRequestSendWithTemplate` or `signatureRequestCreateEmbeddedWithTemplate` call to `createEtchPacket`. Use the field mapping from `references/api-mapping.md`:

- `title` → `name`
- `template_ids` → `files[].castEid` (using the new IDs from the template migration)
- `signers` → `signers[]` (with Anvil's signer structure)
- `custom_fields` → `data.payloads` (with field aliases)
- `test_mode` → `isTest`
- `signing_redirect_url` → handled via `AnvilEmbedFrame` `onEvent`

### Rewrite embedded signing

Replace `embeddedSignUrl` + `HelloSign.open()` with `generateEtchSignURL` + `AnvilEmbedFrame`. See `references/api-mapping.md` for the complete before/after code.

### Rewrite webhook handlers

Map DropboxSign webhook events to Anvil webhook events using `references/api-mapping.md`:
- `signature_request_signed` → `signerComplete`
- `signature_request_all_signed_and_complete` → `etchPacketComplete`
- Remove `EventCallbackHelper` verification and replace with Anvil's webhook verification

Register webhooks programmatically using `createWebhookAction` (see `anvil-document-sdk` skill's webhook reference).

### Update environment variables

- Replace `HELLOSIGN_API_KEY` / `DROPBOX_SIGN_API_KEY` references with `ANVIL_API_KEY`
- Replace `HELLOSIGN_CLIENT_ID` / `DROPBOX_SIGN_CLIENT_ID` references (used for embedded signing) — Anvil uses the API key for everything
- Update `.env.example` if it exists

### Update database schema references

Replace references to DropboxSign columns with the new Anvil columns:
- `hellosign_template_id` → `cast_eid`
- `signature_request_id` → `etch_packet_eid`
- Update queries, model definitions, and type definitions

### Commit checkpoint

After Phase 5 is complete, **pause and check in with the developer**:

**"Phase 5 is complete. Here's a summary of the code changes:**
- **Replaced SDK:** `@dropbox/sign` → `@anvilco/anvil` in [N] files
- **Rewrote [N] signature request calls** to use `createEtchPacket`
- **Rewrote embedded signing** to use `generateEtchSignURL` + `AnvilEmbedFrame`
- **Rewrote [N] webhook handlers** for Anvil events
- **Updated environment variables** and database references

**Would you like to commit these changes now, or do you want to review anything first?"**

Wait for the developer's response before committing or proceeding.

---

## Phase 6: Verification

Guide the developer through verifying the migration works end-to-end.

### Test mode verification

Tell the developer:
**"Let's verify the migration with Anvil's test mode first. Set `isTest: true` on your Etch packets — this watermarks documents but doesn't count against your plan. Make sure your Anvil API key is a development key for testing."**

### Verification checklist

Walk through each integration point from Phase 1:

1. **Template verification** — For each migrated template:
   - Confirm it's published in the Anvil dashboard
   - Verify field aliases match the application's data model
   - Test a `fillPDF` call to confirm data fills correctly

2. **Signature flow verification** — For each signature request path:
   - Create a test Etch packet with `isTest: true`
   - If embedded: verify `AnvilEmbedFrame` loads and the signing experience works
   - If email-based: verify the signer receives the email
   - Complete a test signing

3. **Webhook verification** — For each webhook handler:
   - Confirm webhook is registered with Anvil (via `createWebhookAction` or dashboard)
   - Trigger a test event and verify the handler processes it correctly
   - Verify document download works after signing completes

4. **Document download verification** — Verify signed documents:
   - Download completed documents via `downloadDocuments`
   - Verify they're stored correctly (DB, S3, etc.)
   - Confirm the signing certificate is included

### Clean up

Once the developer is satisfied everything works:

1. **Remove DropboxSign SDK:**
   ```bash
   npm uninstall hellosign-sdk @dropbox/sign
   ```

2. **Remove DropboxSign environment variables** from `.env`, `.env.example`, and deployment configs:
   - `HELLOSIGN_API_KEY`
   - `DROPBOX_SIGN_API_KEY`
   - `HELLOSIGN_CLIENT_ID`
   - `DROPBOX_SIGN_CLIENT_ID`

3. **Remove old database columns** (optional — generate a migration):
   Ask: **"Would you like me to generate a migration to remove the old DropboxSign columns? Or would you prefer to keep them as a backup for a while?"**

4. **Remove the migration scripts and manifests:**
   - `scripts/migrate-dropboxsign-templates.ts`
   - `scripts/migrate-pdfs-to-anvil.ts` (if copied)
   - `migrated-templates/` directory
   - `template-id-mapping.json`
   - `dropboxsign-template-manifest.json`
   - `anvil-migration-manifest.json`

5. **Final check:** Search the codebase one more time for any remaining references to DropboxSign/HelloSign that were missed.

Tell the developer: **"Migration complete! Your e-signature integration is now running on Anvil. Make sure to switch from your development key to your production key and set `isTest: false` when you're ready to go live."**

---

## Reference Links

- Anvil getting started: https://www.useanvil.com/docs/api/getting-started/
- Anvil Etch E-Sign docs: https://www.useanvil.com/docs/api/e-signatures/
- Anvil Node.js client: https://github.com/anvilco/node-anvil
- Anvil React embed: https://github.com/anvilco/react-ui
- Anvil webhooks: https://www.useanvil.com/docs/api/webhooks/
- DropboxSign API reference: https://developers.hellosign.com/api/reference/
