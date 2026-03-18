# Anvil Plugins

Plugins that help developers integrate [Anvil's](https://www.useanvil.com) document automation APIs into their applications. Built for [Claude Cowork](https://claude.com/product/cowork), also compatible with [Claude Code](https://claude.com/product/claude-code).

## Plugins

| Plugin | How it helps |
|--------|-------------|
| **[anvil-document-sdk](./anvil-document-sdk)** | Implement Anvil API integrations — PDF Filling, HTML-to-PDF Generation, Etch E-Sign, and Workflows — into any existing Node.js or TypeScript codebase. |
| **[dropbox-anvil-migration](./dropbox-anvil-migration)** | Migrate existing DropboxSign/HelloSign e-signature integrations to Anvil Etch E-Sign. Discovers integration points, maps APIs, migrates templates, rewrites code, and verifies the migration. |

## Installation

### From Cowork

This repository is a plugin marketplace. To add it to Claude Cowork:

1. Open Claude Cowork
2. Go to `Customize` -  in the left hand side nav bar
3. Click on `Browse plugins`
4. Click on the "Personal" tab
5. Click on the `+` button
6. Select `Add marketplace from GitHub`
7. Add this url as the source: `anvilco/anvil-plugins` 
8. Install the `Anvil document sdk` plugin

### From Claude Code Instance

```bash
/plugin marketplace add anvilco/anvil-plugins
```

then run

```bash
/plugin install <plugin-name>@anvil-plugins
```

or

```bash
/plugin install dropbox-anvil-migration@anvil-plugins
```

## What's Inside

### anvil-document-sdk

A guided implementation skill that walks developers through integrating Anvil's four core products:

- **PDF Filling** — Populate existing PDF templates with dynamic data via `fillPDF`
- **HTML-to-PDF Generation** — Create PDFs from HTML/CSS or structured Markdown via `generatePDF`
- **Etch E-Sign** — Send documents for electronic signature with embedded or email-based signing via `createEtchPacket`
- **Workflows** — Build multi-step document workflows with webforms and approvals via `forgeSubmit`

The skill includes:

- Quick Start flow for 5-minute setup verification
- Full discovery and implementation planning
- Reference files for each product with production-ready code patterns
- Bundled migration script for bulk PDF template uploads with AI-powered field detection
- Best practices for storage, webhooks, rate limiting, and security

### dropbox-anvil-migration

A guided migration skill that walks developers through replacing DropboxSign (HelloSign) e-signature integrations with Anvil Etch E-Sign:

- **Discovery** — Scans for all DropboxSign/HelloSign SDK usage, API calls, env vars, webhooks, and database references
- **API Mapping** — Maps DropboxSign calls to Anvil equivalents with before/after code examples
- **Template Migration** — Downloads templates from DropboxSign, uploads to Anvil, generates DB migration scripts
- **Code Rewriting** — Replaces SDK calls, webhook handlers, embedded signing, and environment variables
- **Verification** — Guides end-to-end testing and cleanup of old dependencies

The skill includes:

- Complete API mapping reference (DropboxSign → Anvil)
- Feature parity analysis with workarounds for each gap
- Bundled template download script (standalone, no external deps)
- Template migration guide with database migration generation
- References the `anvil-document-sdk` skill for Anvil implementation patterns

## Contributing

To add a new plugin to this marketplace:

1. Create a new directory at the root with your plugin name (kebab-case)
2. Add `.claude-plugin/plugin.json` with the plugin manifest
3. Add your skills, commands, or other components
4. Add an entry to `.claude-plugin/marketplace.json`

## License

MIT
