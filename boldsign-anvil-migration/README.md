# BoldSign → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing BoldSign
e-signature integrations to Anvil Etch E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all BoldSign integration points (SDK usage, API
  calls, env vars, webhook handlers, database references)
- **API Mapping** — Maps BoldSign documents, templates, roles, positioned form
  fields, embedded signing, and webhook events to Anvil equivalents
- **Template Migration** — Downloads templates from BoldSign as PDFs with role/field
  metadata, uploads to Anvil (Document AI field detection), generates an ID mapping
- **Code Rewriting** — Replaces the SDK, rewrites embedded signing and webhook
  handlers, updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## What's different about BoldSign

BoldSign sends documents from **flat PDF templates with positioned form fields** —
each field placed by absolute `bounds` (x/y/width/height) on a `pageNumber`. So
template migration is a **PDF download + Anvil Document AI** re-detection pass (the
same shape as the DropboxSign migration), with an optional **dynamic-doc** rebuild
offered for content-heavy templates that would benefit from reflowing text or
repeating tables.

Two BoldSign specifics the plugin handles explicitly:

- **Regional hosts** — US is `api.boldsign.com`, EU is `eu-api.boldsign.com`. Anvil
  uses one global endpoint, so the region host drops out entirely.
- **Multi-tenant / on-behalf sending** — BoldSign's OAuth-on-behalf and `onBehalfOf`
  sends have real Anvil equivalents: an Anvil OAuth app (tenants authorize your app
  against their own org) or a child organization per tenant (isolated templates,
  branding, webhooks, and API keys under one parent). The plugin detects
  multi-tenant usage in discovery and makes the choice an explicit decision.
- **Dashboard-configured webhooks** — BoldSign webhooks are set up in the dashboard
  (account/app-scoped) and verified with an `X-BoldSign-Signature` HMAC. Anvil
  registers webhooks **programmatically** with `createWebhookAction`, so the HMAC
  check is replaced with Anvil's verification.

## How It Works

When a developer mentions migrating from BoldSign to Anvil, the skill triggers and
walks them through six phases:

1. **Discovery** — Finds every BoldSign integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports templates, uploads to Anvil, generates a DB
   migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — BoldSign → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete BoldSign → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — Template migration (PDF + Document AI, with
  the optional dynamic-doc target), step by step

### Scripts

- `scripts/export-boldsign-templates.ts` — Downloads templates from BoldSign as PDFs
  with a role/field metadata manifest (standalone, no BoldSign SDK required)

## Requirements

- A BoldSign API key (for template export)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch packets,
embedded signing, webhooks, document storage) and its `migrate-pdfs-to-anvil.ts`
script for uploading the exported PDFs to Anvil.
