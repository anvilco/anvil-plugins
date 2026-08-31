# Apryse Xodo Sign → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing **Apryse Xodo
Sign** (formerly **eversign**) e-signature integrations to Anvil Etch E-Sign. Xodo
Sign is now part of Apryse; the product began life as eversign, and its REST API
(`api.eversign.com`) still uses the eversign name.

## Capabilities

- **Codebase Discovery** — Scans for all Xodo Sign / eversign integration points
  (SDK usage, REST calls, `access_key` / `business_id`, OAuth/multi-business usage,
  webhook events, database references)
- **API Mapping** — Maps eversign documents, signers, recipients, positioned form
  fields, template merge fields, and log/webhook events to Anvil equivalents, and
  maps eversign's OAuth-on-behalf / multi-business model to Anvil OAuth apps or
  child organizations
- **Template Migration** — Migrates flat-PDF templates (positioned fields) to Anvil
  via Document AI, with an optional dynamic-doc target for content-based templates
- **Code Rewriting** — Replaces the `eversign` SDK, collapses upload → create →
  poll into a single `createEtchPacket`, rewrites embedded signing and webhook
  handlers, updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## Xodo Sign is eversign

Xodo Sign is the current brand for the product formerly called **eversign**. The
API is still hosted at `api.eversign.com`, the official npm package is still
`eversign`, and existing integrations still authenticate with an `access_key` +
`business_id`. This plugin triggers on **both** names and maps the eversign API
surface — there is no separate "Xodo Sign API." Everything a developer has today
runs against eversign endpoints; the plugin treats "Xodo Sign" and "eversign" as
the same platform throughout.

The migration is a good structural fit: eversign templates are **flat PDFs with
positioned fields** (x/y/page coordinates), which map cleanly onto Anvil PDF
templates (Casts) via Document AI field detection — the same path the DropboxSign
plugin uses. Content-heavy templates can optionally target Anvil dynamic docs.

## Multi-business / OAuth integrations

An eversign account can hold several **businesses** (selected per request via
`business_id`), and its OAuth flow lets your app act for other accounts. Both have
real Anvil equivalents. An Anvil **OAuth app** lets tenants authorize your app against
their own organization, and a **child organization** is the natural landing spot for
each business — an isolated org with its own templates, branding, webhook, and API
keys under one parent, where a business had none of its own. The plugin detects
multi-tenant usage in discovery and makes the choice an explicit decision.

## How It Works

When a developer mentions migrating from Xodo Sign or eversign to Anvil, the skill
triggers and walks them through six phases:

1. **Discovery** — Finds every Xodo Sign / eversign integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports templates as PDFs, uploads to Anvil, generates a
   DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — Xodo Sign / eversign → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete eversign → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — The PDF + Document AI path (default) and the
  optional dynamic-doc target, step by step

### Scripts

- `scripts/export-xodosign-templates.ts` — Lists templates from Xodo Sign / eversign,
  downloads each as a PDF, and writes a metadata manifest (roles, recipients, fields).
  Standalone — uses `fetch`, no `eversign` SDK required.

## Requirements

- A Xodo Sign / eversign API access key and Business ID (for template export)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch
packets, embedded signing, webhooks, document storage) and its
`migrate-pdfs-to-anvil.ts` script for the PDF + Document AI upload.
