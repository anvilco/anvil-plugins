#!/usr/bin/env npx ts-node
/**
 * DocuSign Template Export Script
 *
 * Exports templates from DocuSign as "converter-shaped" JSON that Anvil's
 * createCast endpoint can turn directly into an Anvil template (Cast) — with
 * field geometry, field types, and signer roles preserved. See
 * ../references/template-migration.md for the full flow.
 *
 * For each template it writes a `<title>.json` containing:
 *   { emailSubject, emailBlurb, recipients, documents:[{documentId,name,documentBase64}] }
 * plus a `docusign-template-manifest.json` with metadata for the ID mapping.
 *
 * Usage:
 *   npx ts-node export-docusign-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-docusign-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node export-docusign-templates.ts --output-dir ./out --dry-run
 *   npx ts-node export-docusign-templates.ts --output-dir ./out --include-pdf
 *
 * Auth (standalone — no external deps):
 *   DOCUSIGN_ACCESS_TOKEN   an OAuth access token with the `signature` scope (required)
 *   DOCUSIGN_ACCOUNT_ID     optional — discovered from /oauth/userinfo if omitted
 *   DOCUSIGN_BASE_URI       optional — discovered from /oauth/userinfo if omitted
 *   --oauth-host            OAuth host for discovery (default: account-d.docusign.com;
 *                           use account.docusign.com for production)
 *
 * This script uses only `fetch` and Node's fs/path — no DocuSign SDK required.
 * Obtaining a token: use your existing integration's access token, or run a
 * JWT / Authorization Code grant and paste the resulting access token here.
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportConfig {
  outputDir: string
  templateIds?: string[]
  accessToken?: string
  accountId?: string
  baseUri?: string
  oauthHost: string
  delayMs: number
  dryRun: boolean
  includePdf: boolean
}

interface ExportedTemplate {
  templateId: string
  title: string
  jsonFilename: string
  pdfFilenames: string[]
  roles: Array<{ roleName: string; routingOrder: string | null }>
  fieldCount: number
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

async function apiGetJSON(url: string, token: string): Promise<any> {
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${url} failed (HTTP ${res.status}): ${body}`)
  }
  return res.json()
}

async function apiGetBytes(url: string, token: string): Promise<Buffer> {
  const res = await fetch(url, { headers: authHeaders(token) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${url} failed (HTTP ${res.status}): ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** Discover the account's base_uri + accountId from the OAuth userinfo endpoint. */
async function discoverAccount(
  oauthHost: string,
  token: string
): Promise<{ accountId: string; baseUri: string }> {
  const info = await apiGetJSON(`https://${oauthHost}/oauth/userinfo`, token)
  const accounts: any[] = info.accounts || []
  const account = accounts.find((a) => a.is_default === true || a.is_default === 'true') || accounts[0]
  if (!account) throw new Error('No DocuSign accounts found for this token')
  return { accountId: account.account_id, baseUri: account.base_uri }
}

// ---------------------------------------------------------------------------
// DocuSign reads
// ---------------------------------------------------------------------------

function accountBase(baseUri: string, accountId: string): string {
  return `${baseUri}/restapi/v2.1/accounts/${accountId}`
}

async function listAllTemplates(base: string, token: string, delayMs: number): Promise<any[]> {
  const all: any[] = []
  const count = 100
  let startPosition = 0
  // DocuSign paginates via start_position/count; totalSetSize bounds the loop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = `${base}/templates?count=${count}&start_position=${startPosition}`
    const page = await apiGetJSON(url, token)
    const templates = page.envelopeTemplates || []
    all.push(...templates)
    const total = parseInt(page.totalSetSize || '0', 10)
    startPosition += templates.length
    if (!templates.length || startPosition >= total) break
    await sleep(delayMs)
  }
  return all
}

/** Recipients WITH tabs — the tabs carry the field geometry/types the converter needs. */
async function getRecipientsWithTabs(base: string, token: string, templateId: string): Promise<any> {
  return apiGetJSON(
    `${base}/templates/${templateId}/recipients?include_tabs=true`,
    token
  )
}

/** Full template definition — for name, emailSubject/emailBlurb, and document metadata. */
async function getTemplateDefinition(base: string, token: string, templateId: string): Promise<any> {
  return apiGetJSON(`${base}/templates/${templateId}?include=documents`, token)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(title: string): string {
  return (title || 'template')
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100)
}

function countFields(recipients: any): number {
  let n = 0
  for (const signer of recipients?.signers || []) {
    for (const tabList of Object.values(signer.tabs || {})) {
      if (Array.isArray(tabList)) n += tabList.length
    }
  }
  return n
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const config: ExportConfig = {
    outputDir: '',
    oauthHost: 'account-d.docusign.com',
    delayMs: 500,
    dryRun: false,
    includePdf: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--access-token': config.accessToken = args[++i]; break
      case '--account-id': config.accountId = args[++i]; break
      case '--base-uri': config.baseUri = args[++i]; break
      case '--oauth-host': config.oauthHost = args[++i]; break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--dry-run': config.dryRun = true; break
      case '--include-pdf': config.includePdf = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-docusign-templates.ts [options]

Options:
  --output-dir <path>    Directory to save JSON + manifest (required)
  --template-ids <ids>   Comma-separated template IDs (default: all)
  --access-token <tok>   DocuSign access token (or DOCUSIGN_ACCESS_TOKEN)
  --account-id <id>      DocuSign account ID (or DOCUSIGN_ACCOUNT_ID; else discovered)
  --base-uri <uri>       Account base URI (or DOCUSIGN_BASE_URI; else discovered)
  --oauth-host <host>    OAuth host for discovery (default account-d.docusign.com)
  --delay <ms>           Delay between API calls (default 500)
  --include-pdf          Also save each document's raw PDF (fallback path)
  --dry-run              List templates without exporting
  --help                 Show this help
        `)
        process.exit(0)
    }
  }

  const token = config.accessToken ?? process.env.DOCUSIGN_ACCESS_TOKEN
  if (!token) {
    console.error('Error: DOCUSIGN_ACCESS_TOKEN is required (or --access-token).')
    process.exit(1)
  }
  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  // Resolve account + base URI
  let accountId = config.accountId ?? process.env.DOCUSIGN_ACCOUNT_ID
  let baseUri = config.baseUri ?? process.env.DOCUSIGN_BASE_URI
  if (!accountId || !baseUri) {
    console.log('\nDiscovering account from /oauth/userinfo...')
    const discovered = await discoverAccount(config.oauthHost, token)
    accountId = accountId || discovered.accountId
    baseUri = baseUri || discovered.baseUri
    console.log(`  accountId: ${accountId}`)
    console.log(`  base URI:  ${baseUri}`)
  }
  const base = accountBase(baseUri, accountId)

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log('\nFetching templates from DocuSign...\n')
  let templates = await listAllTemplates(base, token, config.delayMs)
  console.log(`Found ${templates.length} template(s).`)

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    const notFound = config.templateIds.filter((id) => !templates.some((t) => t.templateId === id))
    templates = templates.filter((t) => wanted.has(t.templateId))
    if (notFound.length) console.warn(`Warning: not found: ${notFound.join(', ')}`)
    console.log(`Filtered to ${templates.length} template(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.templateId})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const templateId = t.templateId
    const title = t.name || `template-${templateId}`
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)

    try {
      const [recipients, definition] = await Promise.all([
        getRecipientsWithTabs(base, token, templateId),
        getTemplateDefinition(base, token, templateId),
      ])

      // Attach each document's bytes as inline base64 (the converter needs this).
      const docMetas = definition.documents || []
      const documents: Array<{ documentId: string; name: string; documentBase64: string }> = []
      const pdfFilenames: string[] = []
      for (const doc of docMetas) {
        await sleep(config.delayMs)
        const bytes = await apiGetBytes(
          `${base}/templates/${templateId}/documents/${doc.documentId}`,
          token
        )
        documents.push({
          documentId: String(doc.documentId),
          name: doc.name || `document-${doc.documentId}`,
          documentBase64: bytes.toString('base64'),
        })
        if (config.includePdf) {
          const pdfName = `${sanitizeFilename(title)}_doc${doc.documentId}.pdf`
          fs.writeFileSync(path.join(config.outputDir, pdfName), bytes)
          pdfFilenames.push(pdfName)
        }
      }

      // Assemble the converter-shaped JSON.
      const converterJSON = {
        emailSubject: definition.emailSubject,
        emailBlurb: definition.emailBlurb,
        recipients,
        documents,
      }

      const jsonFilename = `${sanitizeFilename(title)}.json`
      fs.writeFileSync(
        path.join(config.outputDir, jsonFilename),
        JSON.stringify(converterJSON, null, 2)
      )

      const roles = (recipients.signers || []).map((s: any) => ({
        roleName: s.roleName || s.name || '',
        routingOrder: s.routingOrder ?? null,
      }))

      console.log(`  ✓ ${jsonFilename} — ${roles.length} role(s), ${countFields(recipients)} field(s), ${documents.length} doc(s)`)

      results.push({
        templateId,
        title,
        jsonFilename,
        pdfFilenames,
        roles,
        fieldCount: countFields(recipients),
        status: 'success',
      })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId, title, jsonFilename: '', pdfFilenames: [], roles: [], fieldCount: 0,
        status: 'error', error: err.message,
      })
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    accountId,
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'docusign-template-manifest.json'),
    JSON.stringify(manifest, null, 2)
  )

  const ok = results.filter((r) => r.status === 'success')
  const failed = results.filter((r) => r.status === 'error')
  console.log('\n--- Export Summary ---')
  console.log(`  Exported: ${ok.length}/${results.length}`)
  if (failed.length) {
    console.log(`  Failed:   ${failed.length}`)
    failed.forEach((f) => console.log(`    - ${f.title}: ${f.error}`))
  }
  console.log('\nNext steps:')
  console.log('  1. Import the JSON to Anvil:  npx ts-node import-docusign-json.ts --dir ' + config.outputDir)
  console.log('  2. Review and publish each template in the Anvil dashboard')
  console.log('  3. Build the template ID mapping for your database migration')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
