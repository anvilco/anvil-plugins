# DropboxSign → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing DropboxSign (formerly HelloSign) e-signature integrations to Anvil Etch E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all DropboxSign/HelloSign integration points (SDK usage, API calls, env vars, API App / OAuth multi-tenant usage, webhooks, database references)
- **API Mapping** — Maps DropboxSign API calls, fields, and events to Anvil equivalents, and maps the API App + OAuth on-behalf model to Anvil OAuth apps or child organizations
- **Template Migration** — Downloads templates from DropboxSign, uploads to Anvil, generates ID mapping
- **Code Rewriting** — Replaces SDK calls, rewrites webhook handlers, updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## Multi-tenant / OAuth integrations

A DropboxSign API App plus the OAuth flow — acting on behalf of other accounts, with the app's `white_labeling_options` branding the signing UI — has a real Anvil equivalent. Anvil is multi-tenant too: an Anvil **OAuth app** lets tenants authorize your app against their own organization, and **child organizations** give each tenant an isolated org — own templates, branding, webhook, and API keys — under one parent. The plugin detects multi-tenant usage in discovery and makes the choice an explicit decision.

## How It Works

When a developer mentions migrating from DropboxSign or HelloSign to Anvil, the skill triggers and walks them through six phases:

1. **Discovery** — Finds every DropboxSign integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs Anvil SDK, configures API key
4. **Template Migration** — Downloads templates, uploads to Anvil, generates DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — DropboxSign → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete DropboxSign → Anvil API mapping with before/after code
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — Step-by-step template migration guide

### Scripts

- `scripts/migrate-dropboxsign-templates.ts` — Downloads templates from DropboxSign as PDFs with metadata manifest (standalone, no external deps)

## Requirements

- DropboxSign API key (for template download)
- Anvil API key (get one at https://www.useanvil.com)
- Node.js / TypeScript codebase
- `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it references that plugin for Anvil implementation patterns (client setup, Etch packets, embedded signing, webhooks, document storage).
