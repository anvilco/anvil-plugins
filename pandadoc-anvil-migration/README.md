# PandaDoc → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing PandaDoc
integrations to Anvil Etch E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all PandaDoc integration points (SDK usage,
  API calls, env vars, OAuth2/workspace multi-tenant usage, webhook subscriptions,
  database references)
- **API Mapping** — Maps PandaDoc's roles/fields/tokens model, async document
  create + send, signing sessions, and webhooks to Anvil equivalents, and maps
  PandaDoc's OAuth2/workspace model to Anvil OAuth apps or child organizations
- **Template Migration** — Migrates block/content-based templates to Anvil, with a
  tiered choice between a structure-preserving dynamic doc and a simpler PDF +
  Document AI pass
- **Code Rewriting** — Replaces the SDK, collapses the create → poll → send flow
  into a single `createEtchPacket`, rewrites embedded signing and webhook handlers,
  updates env vars and DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## What's different about PandaDoc

PandaDoc templates are **block/content-based** — rich-text blocks + merge **tokens**
+ **fields** assigned to roles — not flat PDFs with positioned tabs. There is no
flat-PDF export for a template. The plugin handles this with two migration targets:

- **Dynamic doc (higher fidelity)** — Anvil's structured content documents preserve
  headings, reflowing text, tables, and editability. Blocks map to content nodes,
  tokens to inline field nodes, and fields to typed field nodes. Best for
  content-heavy or repeating-table templates.
- **PDF + Document AI (simpler)** — Render a base PDF and let Anvil's Document AI
  detect fields. Uses only the stable public API; best for simple/fixed layouts.

The plugin recommends a target per template and explains the tradeoffs.

A third PandaDoc specific the plugin handles explicitly: **OAuth2 and workspaces.**
PandaDoc's OAuth2 on-behalf flow and its per-workspace template/branding split both
have real Anvil equivalents. An Anvil **OAuth app** lets tenants authorize your app
against their own organization, and a **child organization** is a stronger version of
a workspace — an isolated org with its own templates, branding, webhook, and API keys
under one parent. The plugin detects multi-tenant usage in discovery and makes the
choice an explicit decision.

## How It Works

When a developer mentions migrating from PandaDoc to Anvil, the skill triggers and
walks them through six phases:

1. **Discovery** — Finds every PandaDoc integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports templates, migrates them (dynamic doc or PDF),
   generates a DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — PandaDoc → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete PandaDoc → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — The two migration targets (dynamic doc vs
  PDF + Document AI), with the dynamic-doc authoring flow

### Scripts

- `scripts/export-pandadoc-templates.ts` — Exports PandaDoc template structure
  (roles, fields, tokens) and renders a base PDF per template, with field geometry
  where available (standalone, no PandaDoc SDK required)

## Requirements

- A PandaDoc API key (a sandbox key works for the export)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch
packets, embedded signing, webhooks, document storage) and its
`migrate-pdfs-to-anvil.ts` script for the PDF + Document AI target.
