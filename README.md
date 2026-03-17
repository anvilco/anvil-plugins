# Anvil Plugins

Plugins that help developers integrate [Anvil's](https://www.useanvil.com) document automation APIs into their applications. Built for [Claude Cowork](https://claude.com/product/cowork), also compatible with [Claude Code](https://claude.com/product/claude-code).

## Plugins

| Plugin | How it helps |
|--------|-------------|
| **[anvil-document-sdk](./anvil-document-sdk)** | Implement Anvil API integrations — PDF Filling, HTML-to-PDF Generation, Etch E-Sign, and Workflows — into any existing Node.js or TypeScript codebase. |

## Installation

### From Cowork

This repository is a plugin marketplace. To add it to Claude Cowork:

1. Open Claude Cowork
2. Go to Settings → Plugins
3. Add this repository as a marketplace source: `useanvil/anvil-plugins`
4. Browse and install the plugins you need

### From Claude Code

```bash
claude plugin add --from useanvil/anvil-plugins anvil-document-sdk
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

## Contributing

To add a new plugin to this marketplace:

1. Create a new directory at the root with your plugin name (kebab-case)
2. Add `.claude-plugin/plugin.json` with the plugin manifest
3. Add your skills, commands, or other components
4. Add an entry to `.claude-plugin/marketplace.json`

## License

MIT
