---
name: anvil-document-templates
description: >
  Create and manage Anvil document templates (Casts) at scale. Use this skill whenever a developer
  wants to create, bulk-upload, or manage Anvil PDF templates — mentions createCast, castEid, Casts,
  Document AI field detection, field aliases (data schema) / aliasIds, turning a folder of PDFs into Anvil templates,
  or migrating a set of existing PDF forms into Anvil as reusable templates. Also trigger when someone
  asks how to upload many PDFs to Anvil, auto-detect form fields on a template, or pre-name detected
  fields with their own field aliases (data schema).
---

# Anvil Document Templates Skill

You are helping a developer create and manage Anvil document templates — called **Casts** in the
Anvil API. A Cast is a reusable PDF template with tagged fields; each has a `castEid` that
integration code references when filling PDFs or building Etch e-sign packets.

This skill focuses on **bulk template creation** from a folder of existing PDFs, using Anvil's
Document AI to auto-detect form fields and (optionally) pre-name those fields from a CSV of field
aliases (data schema). It bundles a ready-to-run script, `scripts/create-casts.ts`.

**For Anvil implementation patterns beyond template creation** — client setup, PDF filling with
`fillPDF`, Etch packets, embedded signing, webhooks — reference the `anvil-document-sdk` skill rather
than reimplementing that guidance here.

---

## When to use this skill

- The developer has a directory of PDF forms they want to turn into Anvil templates.
- They want Document AI to detect the form fields automatically instead of hand-tagging each PDF.
- They have a list of their own field aliases (data schema) they want the detected fields mapped to, so
  the resulting `fieldInfo` aligns with their application's data model.
- They need the resulting `castEid`s collected in a manifest to wire into integration code.

For a one-off single template, uploading through the Anvil dashboard is usually faster — recommend
that instead. This skill earns its keep when there are several PDFs or the field aliases (data schema) matter.

---

## Phase 1: Understand the source templates

Before running anything, **prompt the developer for the two inputs the script needs.** Ask both up
front, in one message, and make clear the second is optional:

> **1. Where are the PDFs?** Give me the path to the directory containing the PDF templates to
> upload. I'll scan that one directory (non-recursive) for `*.pdf` files.
>
> **2. Do you have a field aliases (data schema) CSV? (optional — you can skip this.)** This is a single-column
> CSV of the field names you want the detected fields mapped to (the keys your integration code
> later uses in `fillPDF` / Etch payloads). If you have one, give me the path. If not, just say
> "skip" and I'll upload the PDFs with Document AI detection but no pre-named aliases.

Handle the answers:

- **PDF directory** is required. If the developer doesn't provide it, ask again before proceeding —
  the script cannot run without `--dir`.
- **Aliases CSV** is optional:
  - If they give a path → validate it exists and pass it as `--aliases`.
  - If they say skip / don't have one → run without `--aliases`. Confirm the trade-off:
    **"No problem — Document AI will still detect the fields, you'll just name them yourself in the
    editor afterward."**
  - If they have the field names in a schema (Prisma models, TypeScript interfaces, a JSON schema)
    but not a CSV → offer to extract them into a single-column CSV for them (see Phase 2), rather
    than making them skip.

Also flag one thing up front so it isn't a surprise later:

- **Plan tier.** Document AI field detection requires a plan that includes it. The script detects a
  `RequiresUpgradeError` and falls back to standard field detection automatically — mention this so
  a fallback during upload isn't unexpected.

---

## Phase 2: Environment setup

### Anvil API key

Ask: **"Do you have an Anvil API key? Find it under Organization Settings → API Settings in the
Anvil dashboard (https://app.useanvil.com)."**

Set it in the environment (the script reads `ANVIL_API_KEY`, or accepts `--api-key`):

```
ANVIL_API_KEY=<add api key>
```

Add it to `.env` and confirm `.env` is in `.gitignore`. Development keys are rate-limited to
2 req/s and production keys to 40 req/s — the script's concurrency setting keeps within these.

### Install dependencies

```bash
npm install @anvilco/anvil
npm install -D ts-node typescript
```

### Field aliases (data schema) CSV (optional)

If the developer has field names, put them in a single-column CSV, one alias per line. A header row
of `fieldAlias` or `alias` is allowed and skipped automatically. Example:

```csv
fieldAlias
firstName
lastName
email
effectiveDate
```

---

## Phase 3: Create the templates

Copy the bundled script into the developer's project and run it.

1. Copy the script:
   ```bash
   cp scripts/create-casts.ts ./scripts/
   ```

2. **Dry run first** to confirm which PDFs and aliases the script sees, without uploading:
   ```bash
   npx ts-node scripts/create-casts.ts --dir ./pdfs --aliases ./field-aliases.csv --dry-run
   ```

3. Real run:
   ```bash
   npx ts-node scripts/create-casts.ts --dir ./pdfs --aliases ./field-aliases.csv
   ```

   Without aliases:
   ```bash
   npx ts-node scripts/create-casts.ts --dir ./pdfs
   ```

### What the script does

- Reads field aliases (data schema) from the single-column CSV (dedupes, skips a header row).
- Scans `--dir` for PDF files (non-recursive, sorted).
- Looks up the organization from the API key to build template edit URLs.
- Uploads each PDF via the `createCast` GraphQL mutation with `isTemplate: true` and Document AI
  enabled (`detectBoxesAdvanced` + `advancedDetectFields`), passing the CSV aliases as `aliasIds`.
- If (and only if) the org's plan lacks Document AI (`RequiresUpgradeError`), retries that file with
  standard detection and marks it as a fallback — other errors are reported as-is, never masked.
- Runs uploads through a bounded worker pool (`--concurrency`, default 4) to respect rate limits.
- Opens each created template in edit mode in the browser.
- Writes `anvil-migration-manifest.json` into the PDF directory mapping filename → `castEid`.

### Options

| Flag | Purpose |
| --- | --- |
| `--dir <path>` | Directory of PDFs (required) |
| `--aliases <path>` | Single-column CSV of field aliases (data schema) (optional) |
| `--api-key <key>` | Anvil API key (else `ANVIL_API_KEY`) |
| `--concurrency <n>` | Max parallel `createCast` calls (default 4) |
| `--dry-run` | List PDFs and aliases without uploading |
| `--help` | Show usage |

---

## Phase 4: Review and publish

The script opens each new template in edit mode, but the templates are **not published** — always
walk the developer through review before they're used in production:

1. **Review detected fields.** For each template, confirm Document AI tagged the right fields and
   that the CSV aliases landed on the correct fields. Fix any mis-tags in the editor.
2. **Check field types.** Confirm dates, checkboxes, and signatures are typed correctly.
3. **Publish** each template.
4. **Wire in the `castEid`s.** The manifest (`anvil-migration-manifest.json`) lists each filename,
   its `castEid`, and edit URL — use those in integration code (reference the `anvil-document-sdk`
   skill for `fillPDF` / Etch usage).

Remind the developer: a template must be published before its `castEid` can be used in production
API calls, and switch from a development to a production key when going live.

---

## Reference Links

- Anvil templates (Casts): https://www.useanvil.com/docs/api/graphql/reference/#createcast
- Document AI field detection: https://www.useanvil.com/docs/api/getting-started/
- Anvil Node.js client: https://github.com/anvilco/node-anvil
- API getting started: https://www.useanvil.com/docs/api/getting-started/
