#!/usr/bin/env npx ts-node
/**
 * Xodo Sign (eversign) Template Export Script
 *
 * Xodo Sign is the current brand for the product formerly called eversign. The API
 * is still hosted at api.eversign.com and authenticates with an access_key +
 * business_id. eversign templates are flat PDFs with positioned fields, so this
 * script downloads each template as a PDF (the base document for an Anvil Cast) and
 * captures its roles, CC recipients, and fields — the input for the Anvil upload +
 * Document AI re-tagging step. See ../references/template-migration.md.
 *
 * For each template it writes a `<title>.pdf` plus a
 * `xodosign-template-manifest.json` describing roles, recipients, and fields (types,
 * identifiers, and coordinates) for the ID mapping.
 *
 * Usage:
 *   npx ts-node export-xodosign-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-xodosign-templates.ts --output-dir ./out --template-ids "hash1,hash2"
 *   npx ts-node export-xodosign-templates.ts --output-dir ./out --dry-run
 *   npx ts-node export-xodosign-templates.ts --output-dir ./out --include-archived
 *
 * Auth (standalone — no eversign SDK):
 *   XODOSIGN_API_KEY / EVERSIGN_API_KEY   the eversign access key (required)
 *   XODOSIGN_BUSINESS_ID / EVERSIGN_BUSINESS_ID   optional — the primary business is
 *                                         discovered from GET /business if omitted
 *
 * This script uses only `fetch` and Node's fs/path — no eversign SDK required.
 */

import * as fs from 'fs'
import * as path from 'path'

const API_BASE = 'https://api.eversign.com/api/'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportConfig {
  outputDir: string
  templateIds?: string[]
  apiKey?: string
  businessId?: string
  delayMs: number
  dryRun: boolean
  includeArchived: boolean
}

interface ExportedRole {
  role: string | null
  order: number | null
  required: boolean | null
}

interface ExportedRecipient {
  role: string | null
  name: string | null
  email: string | null
}

interface ExportedField {
  type: string | null
  identifier: string | null
  page: number | null
  x: number | null
  y: number | null
  width: number | null
  height: number | null
  fileIndex: number | null
  signer: string | number | null
  name: string | null
  required: boolean | null
  validationType: string | null
  options: string[] | null
}

interface ExportedTemplate {
  templateId: string | null
  documentHash: string
  title: string
  pdfFilename: string
  roles: ExportedRole[]
  recipients: ExportedRecipient[]
  fields: ExportedField[]
  fieldCount: number
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** eversign auth: access_key (+ business_id) are query parameters on every call. */
function buildUrl(
  endpoint: string,
  apiKey: string,
  params: Record<string, string | number>
): string {
  const query = new URLSearchParams({ access_key: apiKey })
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value))
  }
  return `${API_BASE}${endpoint}?${query.toString()}`
}

async function apiGetJSON(
  endpoint: string,
  apiKey: string,
  params: Record<string, string | number>
): Promise<any> {
  const res = await fetch(buildUrl(endpoint, apiKey, params))
  const text = await res.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`GET ${endpoint} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  // eversign signals failures with { success: false, error: {...} }.
  if (!res.ok || (parsed && parsed.success === false)) {
    const message = parsed?.error?.info || parsed?.error?.type || text.slice(0, 200)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${message}`)
  }
  return parsed
}

async function apiGetBytes(
  endpoint: string,
  apiKey: string,
  params: Record<string, string | number>
): Promise<Buffer> {
  const res = await fetch(buildUrl(endpoint, apiKey, params))
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${body.slice(0, 200)}`)
  }
  const contentType = res.headers.get('content-type') || ''
  const buffer = Buffer.from(await res.arrayBuffer())
  // A JSON body here means an error envelope, not a PDF.
  if (contentType.includes('application/json')) {
    let message = buffer.toString('utf8').slice(0, 200)
    try {
      const parsed = JSON.parse(buffer.toString('utf8'))
      message = parsed?.error?.info || parsed?.error?.type || message
    } catch {
      // keep the raw slice
    }
    throw new Error(`GET ${endpoint} returned an error instead of a PDF: ${message}`)
  }
  return buffer
}

/** Resolve the business_id: use the provided one, else pick the primary business. */
async function resolveBusinessId(apiKey: string, provided?: string): Promise<string> {
  if (provided) return provided
  const businesses = await apiGetJSON('business', apiKey, {})
  const list: any[] = Array.isArray(businesses) ? businesses : businesses?.businesses || []
  if (!list.length) throw new Error('No businesses found for this access key')
  const primary = list.find((b) => b.is_primary === 1 || b.is_primary === true) || list[0]
  const id = primary.business_id ?? primary.id
  if (!id) throw new Error('Could not determine a business_id from GET /business')
  return String(id)
}

// ---------------------------------------------------------------------------
// eversign reads
// ---------------------------------------------------------------------------

function normalizeList(res: any): any[] {
  if (Array.isArray(res)) return res
  return res?.documents || res?.results || []
}

/** List templates. eversign types: templates | templates_archived | template_drafts. */
async function listTemplates(
  apiKey: string,
  businessId: string,
  includeArchived: boolean,
  delayMs: number
): Promise<any[]> {
  const types = includeArchived
    ? ['templates', 'templates_archived', 'template_drafts']
    : ['templates']
  const all: any[] = []
  for (const type of types) {
    const res = await apiGetJSON('document', apiKey, { business_id: businessId, type })
    all.push(...normalizeList(res))
    await sleep(delayMs)
  }
  return all
}

/** Fetch a single template's full definition (fields/roles/recipients) by hash. */
async function getTemplateDetail(
  apiKey: string,
  businessId: string,
  documentHash: string
): Promise<any> {
  return apiGetJSON('document', apiKey, {
    business_id: businessId,
    document_hash: documentHash,
  })
}

// ---------------------------------------------------------------------------
// Field / metadata extraction
// ---------------------------------------------------------------------------

function num(value: any): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function bool(value: any): boolean | null {
  if (value === undefined || value === null) return null
  return value === 1 || value === true || value === '1'
}

/**
 * eversign returns a document's `fields` as an array indexed by file (a 2D array).
 * Flatten it, tracking the file index. Tolerate a flat array too.
 */
function extractFields(detail: any): ExportedField[] {
  const raw = detail?.fields
  if (!Array.isArray(raw)) return []
  const looksNested = raw.length > 0 && Array.isArray(raw[0])
  const groups: any[][] = looksNested ? raw : [raw]
  const fields: ExportedField[] = []
  groups.forEach((group, fileIndex) => {
    if (!Array.isArray(group)) return
    for (const f of group) {
      if (!f || typeof f !== 'object') continue
      fields.push({
        type: f.type ?? null,
        identifier: f.identifier ?? null,
        page: num(f.page),
        x: num(f.x),
        y: num(f.y),
        width: num(f.width),
        height: num(f.height),
        fileIndex: num(f.file_index) ?? fileIndex,
        signer: f.signer ?? null,
        name: f.name ?? null,
        required: bool(f.required),
        validationType: f.validation_type ?? null,
        options: Array.isArray(f.options) ? f.options : null,
      })
    }
  })
  return fields
}

function extractRoles(detail: any): ExportedRole[] {
  const signers: any[] = Array.isArray(detail?.signers) ? detail.signers : []
  return signers.map((s) => ({
    role: s.role ?? null,
    order: num(s.order),
    required: bool(s.required),
  }))
}

function extractRecipients(detail: any): ExportedRecipient[] {
  const recipients: any[] = Array.isArray(detail?.recipients) ? detail.recipients : []
  return recipients.map((r) => ({
    role: r.role ?? null,
    name: r.name ?? null,
    email: r.email ?? null,
  }))
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
    delayMs: 500,
    dryRun: false,
    includeArchived: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--api-key': config.apiKey = args[++i]; break
      case '--business-id': config.businessId = args[++i]; break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--include-archived': config.includeArchived = true; break
      case '--dry-run': config.dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-xodosign-templates.ts [options]

Options:
  --output-dir <path>    Directory to save PDFs + manifest (required)
  --template-ids <ids>   Comma-separated template IDs or document hashes (default: all)
  --api-key <key>        eversign access key (or XODOSIGN_API_KEY / EVERSIGN_API_KEY)
  --business-id <id>     eversign business ID (or XODOSIGN_BUSINESS_ID / EVERSIGN_BUSINESS_ID;
                         else the primary business is discovered)
  --delay <ms>           Delay between API calls (default 500)
  --include-archived     Also export archived templates and template drafts
  --dry-run              List templates without downloading
  --help                 Show this help

Xodo Sign is the current brand for eversign; this script uses the eversign REST API.
        `)
        process.exit(0)
    }
  }

  const apiKey = config.apiKey
    ?? process.env.XODOSIGN_API_KEY
    ?? process.env.EVERSIGN_API_KEY
    ?? process.env.XODOSIGN_ACCESS_KEY
    ?? process.env.EVERSIGN_ACCESS_KEY
  if (!apiKey) {
    console.error('Error: an eversign access key is required (XODOSIGN_API_KEY / EVERSIGN_API_KEY, or --api-key).')
    process.exit(1)
  }
  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  const providedBusinessId = config.businessId
    ?? process.env.XODOSIGN_BUSINESS_ID
    ?? process.env.EVERSIGN_BUSINESS_ID

  console.log('\nResolving business...')
  const businessId = await resolveBusinessId(apiKey, providedBusinessId)
  console.log(`  business_id: ${businessId}`)

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log('\nFetching templates from Xodo Sign (eversign)...\n')
  let templates = await listTemplates(apiKey, businessId, config.includeArchived, config.delayMs)
  console.log(`Found ${templates.length} template(s).`)

  const idOf = (t: any): string => String(t.template_id ?? t.document_hash ?? '')
  const hashOf = (t: any): string => String(t.document_hash ?? t.template_id ?? '')

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    const notFound = config.templateIds.filter(
      (id) => !templates.some((t) => wanted.has(idOf(t)) || wanted.has(hashOf(t)))
    )
    templates = templates.filter((t) => wanted.has(idOf(t)) || wanted.has(hashOf(t)))
    if (notFound.length) console.warn(`Warning: not found: ${notFound.join(', ')}`)
    console.log(`Filtered to ${templates.length} template(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.title || '(untitled)'} (${idOf(t)})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const documentHash = hashOf(t)
    const templateId = t.template_id ? String(t.template_id) : null
    const title = t.title || `template-${documentHash}`
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)

    try {
      if (!documentHash) throw new Error('Template has no document_hash or template_id')

      // Use inline detail from the list when present, else fetch the full object.
      let detail = t
      if (!Array.isArray(detail.fields) && !Array.isArray(detail.signers)) {
        await sleep(config.delayMs)
        detail = await getTemplateDetail(apiKey, businessId, documentHash)
      }

      await sleep(config.delayMs)
      const pdfBuffer = await apiGetBytes('download_raw_document', apiKey, {
        business_id: businessId,
        document_hash: documentHash,
      })
      const pdfFilename = `${sanitizeFilename(title)}.pdf`
      fs.writeFileSync(path.join(config.outputDir, pdfFilename), pdfBuffer)

      const roles = extractRoles(detail)
      const recipients = extractRecipients(detail)
      const fields = extractFields(detail)

      console.log(
        `  ✓ ${pdfFilename} (${(pdfBuffer.length / 1024).toFixed(1)} KB) — ` +
        `${roles.length} role(s), ${recipients.length} CC, ${fields.length} field(s)`
      )
      results.push({
        templateId, documentHash, title, pdfFilename,
        roles, recipients, fields, fieldCount: fields.length,
        status: 'success',
      })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId, documentHash, title, pdfFilename: '',
        roles: [], recipients: [], fields: [], fieldCount: 0,
        status: 'error', error: err.message,
      })
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    source: 'xodosign-eversign',
    businessId,
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'xodosign-template-manifest.json'),
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
  console.log(`\nManifest written to: ${path.join(config.outputDir, 'xodosign-template-manifest.json')}`)
  console.log(`PDFs saved to: ${config.outputDir}`)
  console.log('\nNext steps:')
  console.log('  1. Upload the PDFs to Anvil with the anvil-document-sdk migrate-pdfs-to-anvil.ts')
  console.log('     script (Document AI). Pass the manifest field identifiers as aliases.')
  console.log('  2. Re-tag fields and assign signers in the Anvil template editor using the manifest')
  console.log('     (roles, recipients, fields). Publish each template.')
  console.log('  3. Build the template ID mapping (template_id / document_hash -> castEid) for your DB migration')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
