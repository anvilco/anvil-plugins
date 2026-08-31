# DocuSign → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing DocuSign
eSignature integrations to Anvil Etch E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all DocuSign integration points (SDK usage,
  API calls, env vars, OAuth/`impersonation`/SOBO multi-tenant usage, Connect
  webhooks, database references)
- **API Mapping** — Maps DocuSign envelopes, recipients, tabs, and events to Anvil
  equivalents, and maps DocuSign's multi-account/on-behalf model to Anvil OAuth apps
  or child organizations
- **Template Conversion** — Converts DocuSign templates directly into Anvil
  templates, **preserving field geometry, field types, and signer roles**
- **Code Rewriting** — Replaces SDK calls, rewrites embedded signing and webhook
  handlers, updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## The DocuSign advantage: lossless template conversion

Anvil can convert a DocuSign template/envelope definition **directly** into an
Anvil template. Upload the DocuSign JSON (recipients + tabs +
`documentBase64`) to Anvil's `createCast` endpoint as `application/json`, and
Anvil reconstructs the Anvil template with field coordinates, field types, and
signer roles intact — no PDF re-detection or manual re-tagging required.

This plugin automates that flow with two bundled scripts:

1. `export-docusign-templates.ts` — pulls templates from DocuSign as
   converter-shaped JSON
2. `import-docusign-json.ts` — uploads that JSON to Anvil, producing new
   `castEid`s

A PDF + Document AI fallback is available for any template that doesn't convert
cleanly.

## Multi-tenant / send-on-behalf integrations

DocuSign's Authorization Code grant, JWT `impersonation`, per-tenant `accountId`
switching, and SOBO all have real Anvil equivalents. Anvil is multi-tenant too: an
Anvil **OAuth app** lets tenants authorize your app against their own organization,
and **child organizations** give each tenant an isolated org — own templates,
branding, webhook, and API keys — under one parent. The plugin detects multi-tenant
usage in discovery and makes the choice an explicit decision.

## How It Works

When a developer mentions migrating from DocuSign to Anvil, the skill triggers and
walks them through six phases:

1. **Discovery** — Finds every DocuSign integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports templates, converts them to Anvil, generates a
   DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — DocuSign → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete DocuSign → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — The template converter, step by step

### Scripts

- `scripts/export-docusign-templates.ts` — Exports DocuSign templates as
  converter-shaped JSON (standalone, no DocuSign SDK required)
- `scripts/import-docusign-json.ts` — Uploads the JSON to Anvil's `createCast`
  (requires `@anvilco/anvil`)

## Requirements

- A DocuSign access token with the `signature` scope (for template export)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch
packets, embedded signing, webhooks, document storage).
