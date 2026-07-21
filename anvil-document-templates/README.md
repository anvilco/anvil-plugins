# Anvil Document Templates Plugin

A Claude plugin that helps developers create and manage Anvil document templates (Casts) at scale.

## Capabilities

- **Bulk Template Creation** — Turns a folder of PDFs into Anvil templates via the `createCast` mutation
- **Document AI Field Detection** — Auto-detects form fields on each PDF (`detectBoxesAdvanced` + `advancedDetectFields`)
- **Field Aliases (data schema)** — Applies your own field names from a single-column CSV so detected fields map to your data model
- **Graceful Fallback** — Detects when a plan lacks Document AI and retries with standard detection, without masking unrelated errors
- **Manifest + Review** — Writes a filename → `castEid` manifest and opens each new template in edit mode for review

## How It Works

When a developer wants to create or bulk-upload Anvil templates, the skill triggers and walks them through four phases:

1. **Understand the source templates** — Locate the PDFs, gather field aliases (data schema), confirm plan tier
2. **Environment Setup** — Install the Anvil SDK, configure the API key, prepare the aliases CSV
3. **Create the templates** — Dry-run, then bulk-upload with `scripts/create-casts.ts`
4. **Review and publish** — Verify detected fields, publish, wire the `castEid`s into integration code

## Included Files

### Scripts

- `scripts/create-casts.ts` — Bulk-uploads a directory of PDFs to Anvil as templates with Document AI field detection and CSV-driven field aliases (data schema), writes a manifest, and opens each template in edit mode

## Requirements

- Anvil API key (get one at https://www.useanvil.com)
- Node.js / TypeScript codebase
- `@anvilco/anvil` npm package (`ts-node` + `typescript` to run the script)

## Related

This plugin works alongside [anvil-document-sdk](../anvil-document-sdk) — reference that plugin for Anvil implementation patterns (client setup, `fillPDF`, Etch packets, embedded signing, webhooks) once your templates are published.
