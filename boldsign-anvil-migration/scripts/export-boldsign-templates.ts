#!/usr/bin/env npx ts-node
/**
 * BoldSign Template Export Script
 *
 * Exports templates from BoldSign as PDFs plus a metadata manifest (roles + form
 * fields with types, pages, and positions), for migration to Anvil. BoldSign
 * templates are flat PDFs with positioned form fields, so the migration path is a
 * PDF download + Anvil Document AI re-detection. See ../references/template-migration.md.
 *
 * For each template it writes a `<title>.pdf` plus a `boldsign-template-manifest.json`
 * entry with the template's roles and form fields for the ID mapping + re-tagging.
 *
 * Usage:
 *   npx ts-node export-boldsign-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-boldsign-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node export-boldsign-templates.ts --output-dir ./out --region eu
 *   npx ts-node export-boldsign-templates.ts --output-dir ./out --dry-run
 *
 * Requirements:
 *   BOLDSIGN_API_KEY set in the environment (or --api-key)
 *
 * Standalone — uses only `fetch` and Node's fs/path, no BoldSign SDK. BoldSign
 * authenticates with an `X-API-KEY` header. The base URL is region-specific: US is
 * the default (https://api.boldsign.com); pass `--region eu` (or `--base-url`) for EU.
 *
 * NOTE: field names in the template-properties response are mapped defensively
 * (roles/formFields with a few fallbacks). Confirm against your account's response
 * shape at https://developers.boldsign.com if a field comes through empty.
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportConfig {
  outputDir: string
  templateIds?: string[]
  apiKey?: string
  baseUrl: string
  delayMs: number
  dryRun: boolean
}

interface ExportedRole {
  roleIndex: number | null
  name: string
  signerOrder: number | null
}

interface ExportedField {
  id: string
  name: string
  fieldType: string
  pageNumber: number | null
  bounds: { x: number; y: number; width: number; height: number } | null
  isRequired: boolean
  role: string | null
}

interface ExportedTemplate {
  templateId: string
  title: string
  pdfFilename: string
  roles: ExportedRole[]
  formFields: ExportedField[]
  status: 'success' | 'error' | 'skipped'
  error?: string
}

const REGION_BASE: Record<string, string> = {
  us: 'https://api.boldsign.com',
  eu: 'https://eu-api.boldsign.com',
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function headers(apiKey: string): Record<string, string> {
  return { 'X-API-KEY': apiKey }
}

async function apiGetJSON(baseUrl: string, endpoint: string, apiKey: string): Promise<any> {
  const res = await fetch(`${baseUrl}${endpoint}`, { headers: headers(apiKey) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${body}`)
  }
  return res.json()
}

async function apiGetBytes(baseUrl: string, endpoint: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(`${baseUrl}${endpoint}`, { headers: headers(apiKey) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// BoldSign reads
// ---------------------------------------------------------------------------

async function listAllTemplates(baseUrl: string, apiKey: string, delayMs: number): Promise<any[]> {
  const all: any[] = []
  const pageSize = 100
  let page = 1
  // BoldSign paginates the template list via page/pageSize; stop when a short page returns.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await apiGetJSON(
      baseUrl,
      `/v1/template/list?page=${page}&pageSize=${pageSize}`,
      apiKey
    )
    const items = res.result || res.templates || []
    all.push(...items)
    if (items.length < pageSize) break
    page++
    await sleep(delayMs)
  }
  return all
}

function templateId(t: any): string {
  return t.templateId || t.documentId || t.id
}

function templateName(t: any): string {
  return t.templateName || t.messageTitle || t.title || t.name || `template-${templateId(t)}`
}

async function getTemplateProperties(baseUrl: string, apiKey: string, id: string): Promise<any> {
  return apiGetJSON(baseUrl, `/v1/template/properties?templateId=${encodeURIComponent(id)}`, apiKey)
}

async function downloadTemplatePDF(baseUrl: string, apiKey: string, id: string): Promise<Buffer> {
  return apiGetBytes(baseUrl, `/v1/template/download?templateId=${encodeURIComponent(id)}`, apiKey)
}

// ---------------------------------------------------------------------------
// Mapping helpers (defensive against field-name variations)
// ---------------------------------------------------------------------------

function extractRoles(props: any): ExportedRole[] {
  const roles = props.roles || props.signerDetails || []
  return roles.map((r: any) => ({
    roleIndex: r.roleIndex ?? r.index ?? null,
    name: r.roleName || r.name || r.signerRole || '',
    signerOrder: r.signerOrder ?? r.defaultSignerOrder ?? r.roleIndex ?? null,
  }))
}

function extractFields(props: any): ExportedField[] {
  const fields = props.formFields || props.fields || props.existingFormFields || []
  return fields.map((f: any) => {
    const b = f.bounds || f.rectangle || null
    return {
      id: f.id || f.fieldId || f.name || '',
      name: f.name || f.id || f.fieldId || '',
      fieldType: f.fieldType || f.type || 'Textbox',
      pageNumber: f.pageNumber ?? f.pageInfo?.pageNumber ?? null,
      bounds: b
        ? { x: b.x ?? b.left ?? 0, y: b.y ?? b.top ?? 0, width: b.width ?? 0, height: b.height ?? 0 }
        : null,
      isRequired: !!(f.isRequired ?? f.required),
      role: f.signerRole || f.role || null,
    }
  })
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
    baseUrl: REGION_BASE.us,
    delayMs: 500,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--api-key': config.apiKey = args[++i]; break
      case '--region': config.baseUrl = REGION_BASE[args[++i]] || REGION_BASE.us; break
      case '--base-url': config.baseUrl = args[++i].replace(/\/$/, ''); break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--dry-run': config.dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-boldsign-templates.ts [options]

Options:
  --output-dir <path>    Directory to save PDFs + manifest (required)
  --template-ids <ids>   Comma-separated template IDs (default: all)
  --api-key <key>        BoldSign API key (or set BOLDSIGN_API_KEY)
  --region <us|eu>       BoldSign region (default us)
  --base-url <url>       Override the base URL (e.g. https://eu-api.boldsign.com)
  --delay <ms>           Delay between API calls (default 500)
  --dry-run              List templates without downloading
  --help                 Show this help
        `)
        process.exit(0)
    }
  }

  const apiKey = config.apiKey ?? process.env.BOLDSIGN_API_KEY
  if (!apiKey) {
    console.error('Error: BOLDSIGN_API_KEY is required (or --api-key).')
    process.exit(1)
  }
  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  const region = config.baseUrl === REGION_BASE.eu ? 'eu' : config.baseUrl === REGION_BASE.us ? 'us' : 'custom'

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log(`\nFetching templates from BoldSign (${config.baseUrl})...\n`)
  let templates = await listAllTemplates(config.baseUrl, apiKey, config.delayMs)
  console.log(`Found ${templates.length} template(s).`)

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    templates = templates.filter((t) => wanted.has(templateId(t)))
    console.log(`Filtered to ${templates.length} template(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${templateName(t)} (${templateId(t)})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const id = templateId(t)
    const title = templateName(t)
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)

    try {
      const [props, pdfBuffer] = await Promise.all([
        getTemplateProperties(config.baseUrl, apiKey, id),
        downloadTemplatePDF(config.baseUrl, apiKey, id),
      ])

      const pdfFilename = `${sanitizeFilename(title)}.pdf`
      fs.writeFileSync(path.join(config.outputDir, pdfFilename), pdfBuffer)

      const roles = extractRoles(props)
      const formFields = extractFields(props)

      console.log(`  ✓ ${pdfFilename} — ${roles.length} role(s), ${formFields.length} field(s)`)
      results.push({ templateId: id, title, pdfFilename, roles, formFields, status: 'success' })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId: id, title, pdfFilename: '', roles: [], formFields: [],
        status: 'error', error: err.message,
      })
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    region,
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'boldsign-template-manifest.json'),
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
  console.log('     (Document AI field detection), then re-tag fields using the manifest')
  console.log('  2. Map roles → signers and fields → aliases; build the template ID mapping')
  console.log('  3. Generate and run your database migration (see template-migration.md)')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
