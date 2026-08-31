# signNow → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing signNow (airSlate
SignNow) e-signature integrations to Anvil Etch E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all signNow integration points (SDK usage, API
  calls, OAuth env vars, multi-tenant/on-behalf usage, event subscriptions, database
  references)
- **API Mapping** — Maps signNow's two-step OAuth, template copy + prefill + field
  invite flow, embedded invites, and event subscriptions to Anvil equivalents, and
  maps signNow's authorization-code / per-user password grant to Anvil OAuth apps or
  child organizations
- **Template Migration** — Downloads templates from signNow as PDFs, uploads to
  Anvil with Document AI field detection, generates an ID mapping
- **Code Rewriting** — Replaces the SDK, collapses the copy → prefill → invite
  sequence into a single `createEtchPacket`, rewrites embedded signing and webhook
  handlers, updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## What's different about signNow

Two things shape a signNow → Anvil migration:

- **Two-step OAuth.** signNow exchanges a Basic client credential
  (`base64(client_id:client_secret)`) at `POST /oauth2/token` for a Bearer access
  token, then sends that token on every other call. Anvil uses one long-lived API
  key — the entire token exchange and refresh logic disappears.
- **Multi-call sends.** signNow copies a template into a document, prefills it, then
  sends a role-based field invite as separate API calls. Anvil collapses that into a
  single synchronous `createEtchPacket`.
- **Multi-tenant / on-behalf sending.** signNow's authorization-code grant and its
  per-user password grant both have real Anvil equivalents. An Anvil **OAuth app**
  lets tenants authorize your app against their own organization, and **child
  organizations** give each tenant an isolated org — own templates, branding,
  webhook, and API keys — under one parent. The plugin detects multi-tenant usage in
  discovery and makes the choice an explicit decision.

signNow templates are **flat PDFs with positioned fields**, so they migrate via PDF
download + Anvil's Document AI field detection. A dynamic-doc target is offered for
content-based templates that would benefit from reflowing text or repeating tables.

## How It Works

When a developer mentions migrating from signNow to Anvil, the skill triggers and
walks them through six phases:

1. **Discovery** — Finds every signNow integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports templates as PDFs, uploads to Anvil, generates a
   DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — signNow → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete signNow → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — Template migration (PDF + Document AI default,
  with the optional dynamic-doc target)

### Scripts

- `scripts/export-signnow-templates.ts` — Exports signNow templates as PDFs with a
  metadata manifest (roles, fields, coordinates); standalone, no signNow SDK required

## Requirements

- signNow API credentials — an OAuth client (client id/secret) plus user credentials,
  or a pre-obtained Bearer access token (for template export)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, document storage) and its `migrate-pdfs-to-anvil.ts`
script for uploading the exported template PDFs.
