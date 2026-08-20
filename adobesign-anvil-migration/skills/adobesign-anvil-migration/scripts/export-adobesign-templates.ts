#!/usr/bin/env npx ts-node
/**
 * Adobe Acrobat Sign Library Document Export Script
 *
 * Exports Adobe Sign **library documents** (reusable templates) as PDFs plus a
 * metadata manifest, for migration into Anvil. Adobe library documents are flat
 * PDFs with positioned form fields, so the migration path is PDF + Anvil Document
 * AI (re-detect fields on import). See ../references/template-migration.md.
 *
 * Per library document it writes:
 *   - `<name>.pdf`  — the combined document PDF
 *   - an entry in `adobesign-template-manifest.json` (id, title, scope, sharing
 *     mode, template types, and best-effort form fields)
 *
 * Usage:
 *   npx ts-node export-adobesign-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-adobesign-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node export-adobesign-templates.ts --output-dir ./out --dry-run
 *   npx ts-node export-adobesign-templates.ts --output-dir ./out --base-uri https://api.na2.adobesign.com
 *
 * Auth (standalone — no Adobe SDK):
 *   ADOBE_SIGN_ACCESS_TOKEN   an OAuth access token OR an Integration Key (required;
 *                             or pass --access-token / --api-key). Sent as a Bearer.
 *   ADOBE_SIGN_BASE_URI       optional — the account's API access point or full v6
 *                             base (e.g. https://api.na1.adobesign.com). If omitted,
 *                             discovered via GET /baseUris against --discovery-host.
 *   ADOBE_SIGN_API_USER       optional — an x-api-user value (e.g. "email:me@co.com")
 *                             to read library documents owned by a specific user.
 *
 * NOTE: base-URI discovery defaults to the na1 shard. If your account is on another
 * data center and you don't pass --base-uri, pass --discovery-host for that shard
 * (e.g. api.eu2.adobesign.com). Form-field capture is best-effort — Anvil's Document
 * AI re-detects fields from the PDF on import regardless.
 *
 * This script uses only `fetch` and Node's fs/path — no Adobe SDK required.
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
  baseUri?: string
  discoveryHost: string
  apiUser?: string
  delayMs: number
  dryRun: boolean
}

interface ExportedTemplate {
  libraryDocumentId: string
  title: string
  pdfFilename: string
  scope: string | null
  templateTypes: string[]
  sharingMode: string | null
  modifiedDate: string | null
  fields: Array<{ name: string; type: string }>
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string, apiUser?: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (apiUser) headers['x-api-user'] = apiUser
  return headers
}

async function apiGetJSON(url: string, token: string, apiUser?: string): Promise<any> {
  const res = await fetch(url, { headers: authHeaders(token, apiUser) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${url} failed (HTTP ${res.status}): ${body}`)
  }
  return res.json()
}

async function apiGetBytes(url: string, token: string, apiUser?: string): Promise<Buffer> {
  const res = await fetch(url, { headers: authHeaders(token, apiUser) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${url} failed (HTTP ${res.status}): ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// Base URI resolution
// ---------------------------------------------------------------------------

/** Normalize any access-point / base value to a full ".../api/rest/v6" base. */
function normalizeBase(value: string): string {
  let v = value.trim().replace(/\/+$/, '')
  if (!/\/api\/rest\/v6$/.test(v)) v = `${v}/api/rest/v6`
  return v
}

/**
 * Resolve the v6 base URI. Every v6 call runs on the account's data-center host.
 * Prefer an explicit --base-uri; otherwise ask GET /baseUris for the apiAccessPoint.
 */
async function resolveBaseUri(config: ExportConfig, token: string): Promise<string> {
  if (config.baseUri) return normalizeBase(config.baseUri)

  const discoveryBase = normalizeBase(`https://${config.discoveryHost}`)
  console.log(`\nDiscovering API base URI via GET ${discoveryBase}/baseUris...`)
  const info = await apiGetJSON(`${discoveryBase}/baseUris`, token, config.apiUser)
  const accessPoint: string | undefined = info.apiAccessPoint
  if (!accessPoint) {
    throw new Error(
      'GET /baseUris did not return an apiAccessPoint. Pass --base-uri explicitly ' +
        '(e.g. https://api.na1.adobesign.com).'
    )
  }
  const base = normalizeBase(accessPoint)
  console.log(`  apiAccessPoint: ${accessPoint}`)
  console.log(`  base URI:       ${base}`)
  return base
}

// ---------------------------------------------------------------------------
// Adobe Sign reads
// ---------------------------------------------------------------------------

/** List all library documents, following cursor-based pagination. */
async function listAllLibraryDocuments(
  base: string,
  token: string,
  apiUser: string | undefined,
  delayMs: number
): Promise<any[]> {
  const all: any[] = []
  let cursor: string | undefined
  const pageSize = 100
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({ pageSize: String(pageSize) })
    if (cursor) params.set('cursor', cursor)
    const page = await apiGetJSON(`${base}/libraryDocuments?${params.toString()}`, token, apiUser)
    const items: any[] = page.libraryDocumentList || page.libraryDocuments || []
    all.push(...items)
    cursor = page.page?.nextCursor
    if (!cursor || !items.length) break
    await sleep(delayMs)
  }
  return all
}

/** Best-effort form-field capture; tolerate accounts/documents where it isn't served. */
async function tryGetFields(
  base: string,
  token: string,
  apiUser: string | undefined,
  id: string
): Promise<Array<{ name: string; type: string }>> {
  try {
    const res = await apiGetJSON(`${base}/libraryDocuments/${id}/formFields`, token, apiUser)
    const raw: any[] = res.fields || res.formFields || res || []
    if (!Array.isArray(raw)) return []
    return raw.map((f: any) => ({
      name: f.name || f.fieldName || f.originalFieldName || '',
      type: f.inputType || f.contentType || f.type || 'unknown',
    }))
  } catch {
    // formFields is not reliably exposed for library documents on every account;
    // Document AI re-detects fields from the PDF on import, so this is only a hint.
    return []
  }
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
    discoveryHost: 'api.na1.adobesign.com',
    delayMs: 500,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--access-token':
      case '--api-key': config.accessToken = args[++i]; break
      case '--base-uri': config.baseUri = args[++i]; break
      case '--discovery-host': config.discoveryHost = args[++i]; break
      case '--api-user': config.apiUser = args[++i]; break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--dry-run': config.dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-adobesign-templates.ts [options]

Options:
  --output-dir <path>     Directory to save PDFs + manifest (required)
  --template-ids <ids>    Comma-separated libraryDocumentIds (default: all)
  --access-token <tok>    OAuth access token or Integration Key
                          (or ADOBE_SIGN_ACCESS_TOKEN). --api-key is an alias.
  --base-uri <uri>        Account API access point or full v6 base
                          (or ADOBE_SIGN_BASE_URI; else discovered via /baseUris)
  --discovery-host <host> Host for /baseUris discovery (default api.na1.adobesign.com)
  --api-user <val>        x-api-user value, e.g. "email:me@co.com" (or ADOBE_SIGN_API_USER)
  --delay <ms>            Delay between API calls (default 500)
  --dry-run               List library documents without exporting
  --help                  Show this help
        `)
        process.exit(0)
    }
  }

  const token =
    config.accessToken ??
    process.env.ADOBE_SIGN_ACCESS_TOKEN ??
    process.env.ADOBE_SIGN_INTEGRATION_KEY
  if (!token) {
    console.error(
      'Error: an access token is required (ADOBE_SIGN_ACCESS_TOKEN, ADOBE_SIGN_INTEGRATION_KEY, or --access-token/--api-key).'
    )
    process.exit(1)
  }
  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  const apiUser = config.apiUser ?? process.env.ADOBE_SIGN_API_USER
  config.apiUser = apiUser
  if (config.baseUri === undefined && process.env.ADOBE_SIGN_BASE_URI) {
    config.baseUri = process.env.ADOBE_SIGN_BASE_URI
  }

  const base = await resolveBaseUri(config, token)

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log('\nFetching library documents from Adobe Sign...\n')
  let templates = await listAllLibraryDocuments(base, token, apiUser, config.delayMs)
  console.log(`Found ${templates.length} library document(s).`)

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    const notFound = config.templateIds.filter((id) => !templates.some((t) => t.id === id))
    templates = templates.filter((t) => wanted.has(t.id))
    if (notFound.length) console.warn(`Warning: not found: ${notFound.join(', ')}`)
    console.log(`Filtered to ${templates.length} library document(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.id})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const id = t.id
    const title = t.name || `library-document-${id}`
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)

    try {
      const pdfBuffer = await apiGetBytes(
        `${base}/libraryDocuments/${id}/combinedDocument`,
        token,
        apiUser
      )
      const pdfFilename = `${sanitizeFilename(title)}.pdf`
      fs.writeFileSync(path.join(config.outputDir, pdfFilename), pdfBuffer)

      await sleep(config.delayMs)
      const fields = await tryGetFields(base, token, apiUser, id)

      console.log(
        `  ✓ ${pdfFilename} (${(pdfBuffer.length / 1024).toFixed(1)} KB) — ${fields.length} field(s)`
      )

      results.push({
        libraryDocumentId: id,
        title,
        pdfFilename,
        scope: t.scope ?? null,
        templateTypes: t.templateTypes || [],
        sharingMode: t.sharingMode ?? null,
        modifiedDate: t.modifiedDate ?? null,
        fields,
        status: 'success',
      })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        libraryDocumentId: id,
        title,
        pdfFilename: '',
        scope: t.scope ?? null,
        templateTypes: t.templateTypes || [],
        sharingMode: t.sharingMode ?? null,
        modifiedDate: t.modifiedDate ?? null,
        fields: [],
        status: 'error',
        error: err.message,
      })
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    baseUri: base,
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'adobesign-template-manifest.json'),
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
  console.log('  1. Upload the PDFs to Anvil with the anvil-document-sdk migrate-pdfs-to-anvil.ts script')
  console.log('     (use Document AI field detection), OR build a dynamic doc — see template-migration.md')
  console.log('  2. Re-tag fields and assign signers (roles) in the Anvil template editor using the manifest')
  console.log('  3. Publish each template and build your template ID mapping (libraryDocumentId → castEid)')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
