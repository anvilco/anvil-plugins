# Anvil Document SDK Plugin

A Claude plugin that helps developers integrate Anvil's document automation APIs into their existing Node.js or TypeScript codebases.

## Capabilities

- **PDF Filling** — Populate existing PDF templates with dynamic data
- **HTML-to-PDF Generation** — Create PDFs from HTML/CSS or structured Markdown
- **Etch E-Sign** — Send documents for electronic signature with embedded or email-based signing
- **Workflows** — Build multi-step document workflows with webforms and approvals

## How It Works

When a developer mentions Anvil, PDF filling, e-signatures, or document automation, the skill triggers automatically and guides them through:

1. **Quick Start** — 5-minute setup to verify Anvil connectivity
2. **Discovery** — Identifies which Anvil products fit the developer's use case
3. **Implementation Planning** — Maps integration points in the existing codebase
4. **Code Generation** — Writes production-ready integration code

## Included Reference Files

- `pdf-filling.md` — `fillPDF` patterns, route handlers, BLOB storage
- `html-to-pdf.md` — HTML/CSS and Markdown PDF generation, React SSR patterns
- `etch-esign.md` — `createEtchPacket`, signer configuration, embedded signing, document download
- `workflows.md` — `forgeSubmit`, webform pre-filling, iframe embedding, document download
- `webhooks.md` — Event registration and handler patterns for all products

## Migration Script

The plugin bundles `scripts/migrate-pdfs-to-anvil.ts` for bulk uploading PDFs as Anvil templates. Features:

- AI-powered field detection (`detectBoxesAdvanced`, `advancedDetectFields`) with automatic fallback
- Schema-based field alias extraction (Prisma, Sequelize, TypeORM, JSON Schema, TypeScript)
- Rate limit handling and migration manifest generation

## Requirements

- Anvil API key (get one at https://www.useanvil.com)
- Node.js / TypeScript codebase
- `@anvilco/anvil` npm package
