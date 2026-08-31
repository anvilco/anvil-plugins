# Adobe Acrobat Sign → Anvil Migration Plugin

A Claude plugin that guides developers through migrating existing Adobe Acrobat
Sign (Adobe Sign, formerly EchoSign) e-signature integrations to Anvil Etch
E-Sign.

## Capabilities

- **Codebase Discovery** — Scans for all Adobe Sign integration points (SDK usage,
  REST v6 calls, OAuth/Integration-Key config, `x-api-user` multi-tenant usage, env
  vars, webhooks, database references)
- **API Mapping** — Maps Adobe's transient documents, library documents,
  agreements, participant sets, form fields, and events to Anvil equivalents, and
  maps Adobe's OAuth-on-behalf / `x-api-user` model to Anvil OAuth apps or child
  organizations
- **Template Migration** — Exports Adobe **library documents** as PDFs + metadata,
  uploads to Anvil (Document AI field detection), with a **dynamic-doc** option for
  content-based agreements
- **Code Rewriting** — Replaces the OAuth + shard base-URI handshake, rewrites
  agreement creation, embedded signing, and webhook handlers, updates env vars and
  DB schema
- **Verification** — Guides end-to-end testing of the migrated integration

## What this migration simplifies: the enterprise auth model

Adobe Sign is the most enterprise-shaped provider of the set, and most of the
migration effort is **collapsing its access model**, not its documents:

- **OAuth2 *or* an Integration Key** (both sent as `Authorization: Bearer …`) →
  one long-lived `ANVIL_API_KEY`.
- **Shard base-URI discovery** — every integration must first call `GET /baseUris`
  (or read `api_access_point` from the OAuth token) to find its data-center host
  (`api.na1.adobesign.com`, `api.eu2.adobesign.com`, …) before any real call →
  Anvil has a single fixed host, no discovery step.
- **`x-api-user` sender impersonation** → for a single account, access control just
  lives in your app. For a multi-tenant integration, it becomes a per-tenant
  credential instead of a per-call header: an Anvil **OAuth app** (tenants authorize
  your app against their own organization) or a **child organization** per tenant —
  an isolated org with its own templates, branding, webhook, and API keys under one
  parent. The plugin detects this in discovery and makes the choice an explicit
  decision.

Adobe **library documents** are flat PDFs with positioned form fields, so templates
migrate via the **PDF + Anvil Document AI** path (the same one the DropboxSign
plugin uses). For content-heavy or reflowing agreements, the plugin also offers
Anvil **dynamic docs** as a higher-fidelity target, chosen per template.

> **v6 form-field note.** In Adobe Sign v6, form fields are **not** set on
> `POST /agreements` the way they were in v5 — you create the agreement in
> `state: "AUTHORING"` and place fields with `PUT /agreements/{id}/formFields`.
> Templates (library documents) carry their fields with them, which is exactly why
> the template path is the clean way across.

## How It Works

When a developer mentions migrating from Adobe Sign to Anvil, the skill triggers and
walks them through six phases:

1. **Discovery** — Finds every Adobe Sign integration point in the codebase
2. **API Mapping** — Maps features to Anvil equivalents, surfaces parity gaps
3. **Environment Setup** — Installs the Anvil SDK, configures the API key
4. **Template Migration** — Exports library documents, uploads to Anvil, generates a
   DB migration
5. **Code Migration** — Rewrites integration code file by file
6. **Verification** — Tests everything end-to-end, cleans up old dependencies

## Included Files

### Reference Files

- `references/terminology.md` — Adobe Sign → Anvil vocabulary map (glossary)
- `references/api-mapping.md` — Complete Adobe Sign v6 → Anvil API mapping with
  before/after code, plus how to list/read Anvil templates
- `references/feature-parity.md` — Feature gaps and workarounds
- `references/template-migration.md` — The two migration targets (PDF + Document AI
  vs dynamic doc), with the per-template choice rule

### Scripts

- `scripts/export-adobesign-templates.ts` — Exports Adobe **library documents** as
  PDFs with a metadata manifest (roles, fields, sharing mode) — standalone, no Adobe
  SDK required

## Requirements

- An Adobe Sign OAuth access token or Integration Key with library + agreement read
  scopes (for template export)
- The account's API base URI (from `GET /baseUris`, or discovered by the script)
- An Anvil API key (get one at https://www.useanvil.com)
- A Node.js / TypeScript codebase
- The `@anvilco/anvil` npm package

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — it
references that plugin for Anvil implementation patterns (client setup, Etch
packets, embedded signing, webhooks, document storage) and its
`migrate-pdfs-to-anvil.ts` script for the PDF + Document AI target.
