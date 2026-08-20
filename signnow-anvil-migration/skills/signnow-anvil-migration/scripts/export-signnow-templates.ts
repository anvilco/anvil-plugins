#!/usr/bin/env npx ts-node
/**
 * signNow Template Export Script
 *
 * Downloads templates from signNow (airSlate SignNow) as PDFs and writes a manifest
 * with each template's roles and fields (types + coordinates) for migration to
 * Anvil. See ../references/template-migration.md for the full flow.
 *
 * signNow templates are flat PDFs with positioned fields, so this exports the
 * template PDF (the base document) plus its structure — the input for the Anvil
 * PDF + Document AI upload step (anvil-document-sdk's migrate-pdfs-to-anvil.ts).
 *
 * Usage:
 *   npx ts-node export-signnow-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-signnow-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node export-signnow-templates.ts --output-dir ./out --dry-run
 *   npx ts-node export-signnow-templates.ts --output-dir ./out --host api.eval-signnow.com
 *
 * Auth (standalone — no signNow SDK). signNow uses a two-step OAuth handshake: a
 * Basic client credential is exchanged at POST /oauth2/token for a Bearer access
 * token, which authorizes every other call. Provide EITHER:
 *   SIGNNOW_API_TOKEN     a pre-obtained Bearer access token (skips the exchange), or
 *   --api-token <token>
 * OR the pieces to run the exchange here (password grant):
 *   SIGNNOW_CLIENT_ID + SIGNNOW_CLIENT_SECRET   (or SIGNNOW_BASIC_TOKEN, pre-encoded)
 *   SIGNNOW_USERNAME + SIGNNOW_PASSWORD
 *
 * This script uses only `fetch` and Node's fs/path — no external dependencies.
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportConfig {
  outputDir: string
  templateIds?: string[]
  apiToken?: string
  host: string
  delayMs: number
  dryRun: boolean
}

interface TemplateRole {
  name: string
  roleId: string | null
  signingOrder: number | null
}

interface TemplateField {
  name: string
  type: string
  role: string | null
  required: boolean | null
  pageNumber: number | null
  x: number | null
  y: number | null
  width: number | null
  height: number | null
}

interface ExportedTemplate {
  templateId: string
  title: string
  pdfFilename: string
  roles: TemplateRole[]
  fields: TemplateField[]
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

async function apiGetJSON(host: string, endpoint: string, token: string): Promise<any> {
  const res = await fetch(`https://${host}${endpoint}`, { headers: bearer(token) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${body}`)
  }
  return res.json()
}

async function apiGetBytes(host: string, endpoint: string, token: string): Promise<Buffer> {
  const res = await fetch(`https://${host}${endpoint}`, { headers: bearer(token) })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Step 1 of signNow's two-step auth: exchange a Basic client credential for a
 * Bearer access token via the password grant. Only POST /oauth2/token accepts the
 * Basic credential; everything else uses the returned Bearer token.
 */
async function exchangeForToken(host: string): Promise<string> {
  const preencoded = process.env.SIGNNOW_BASIC_TOKEN
  const clientId = process.env.SIGNNOW_CLIENT_ID
  const clientSecret = process.env.SIGNNOW_CLIENT_SECRET
  const basic = preencoded
    ? preencoded
    : clientId && clientSecret
      ? Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      : null

  const username = process.env.SIGNNOW_USERNAME
  const password = process.env.SIGNNOW_PASSWORD

  if (!basic || !username || !password) {
    throw new Error(
      'No access token provided and cannot exchange one. Set SIGNNOW_API_TOKEN ' +
        '(or --api-token), OR set SIGNNOW_CLIENT_ID + SIGNNOW_CLIENT_SECRET ' +
        '(or SIGNNOW_BASIC_TOKEN) together with SIGNNOW_USERNAME + SIGNNOW_PASSWORD.'
    )
  }

  const res = await fetch(`https://${host}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'password', username, password }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${body}`)
  }
  const json = await res.json()
  if (!json.access_token) throw new Error('Token exchange returned no access_token')
  return json.access_token
}

// ---------------------------------------------------------------------------
// signNow reads
// ---------------------------------------------------------------------------

/** Recursively collect folders so we can find the system "Templates" folder. */
function flattenFolders(node: any, acc: any[]): void {
  if (!node) return
  const folders: any[] = node.folders || node.data || (Array.isArray(node) ? node : [])
  for (const f of folders) {
    acc.push(f)
    if (f.folders?.length) flattenFolders(f, acc)
  }
}

async function findTemplatesFolderId(host: string, token: string): Promise<string> {
  const res = await apiGetJSON(host, '/user/folders', token)
  const all: any[] = []
  flattenFolders(res, all)
  const templates = all.find(
    (f) => (f.name || '').toLowerCase() === 'templates' || f.system_folder === 'templates'
  )
  if (!templates?.id) {
    throw new Error(
      'Could not locate the "Templates" folder in /user/folders. ' +
        'Verify the folder response shape against the live signNow docs.'
    )
  }
  return templates.id
}

/** List the template documents in the Templates folder (paginated). */
async function listTemplates(host: string, token: string, folderId: string, delayMs: number): Promise<any[]> {
  const all: any[] = []
  const limit = 100
  let offset = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await apiGetJSON(
      host,
      `/folder/${folderId}?limit=${limit}&offset=${offset}`,
      token
    )
    const docs: any[] = page.documents || page.data || []
    all.push(...docs)
    if (docs.length < limit) break
    offset += docs.length
    await sleep(delayMs)
  }
  // Keep only entries flagged as templates when the flag is present.
  const templates = all.filter((d) => d.template === true || d.template === 'true' || d.is_template)
  return templates.length ? templates : all
}

/** Full document/template detail — roles + fields (with coordinates where present). */
async function getTemplateDetail(host: string, token: string, templateId: string): Promise<any> {
  return apiGetJSON(host, `/document/${templateId}`, token)
}

function extractRoles(detail: any): TemplateRole[] {
  return (detail.roles || []).map((r: any) => ({
    name: r.name || r.role || '',
    roleId: r.unique_id || r.role_id || r.id || null,
    signingOrder: r.signing_order ?? null,
  }))
}

function extractFields(detail: any): TemplateField[] {
  const raw: any[] = detail.fields || []
  return raw.map((f: any) => {
    const attrs = f.json_attributes || f
    return {
      name: attrs.name || attrs.label || attrs.field_name || f.type || 'field',
      type: f.type || attrs.type || 'text',
      role: f.role || attrs.role || null,
      required: attrs.required ?? null,
      pageNumber: attrs.page_number ?? null,
      x: attrs.x ?? null,
      y: attrs.y ?? null,
      width: attrs.width ?? null,
      height: attrs.height ?? null,
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
    host: 'api.signnow.com',
    delayMs: 500,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--api-token': config.apiToken = args[++i]; break
      case '--host': config.host = args[++i]; break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--dry-run': config.dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-signnow-templates.ts [options]

Options:
  --output-dir <path>    Directory to save PDFs + manifest (required)
  --template-ids <ids>   Comma-separated template IDs (default: all in Templates folder)
  --api-token <token>    signNow Bearer access token (or set SIGNNOW_API_TOKEN)
  --host <host>          API host (default api.signnow.com; use api.eval-signnow.com for sandbox)
  --delay <ms>           Delay between API calls (default 500)
  --dry-run              List templates without downloading
  --help                 Show this help

Auth: pass a Bearer token via --api-token / SIGNNOW_API_TOKEN, OR let the script
exchange one from SIGNNOW_CLIENT_ID + SIGNNOW_CLIENT_SECRET (or SIGNNOW_BASIC_TOKEN)
plus SIGNNOW_USERNAME + SIGNNOW_PASSWORD (password grant).
        `)
        process.exit(0)
    }
  }

  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  // Resolve the Bearer token (provided, or exchanged via the two-step handshake).
  let token = config.apiToken ?? process.env.SIGNNOW_API_TOKEN
  if (!token) {
    console.log('\nNo access token provided — exchanging a Basic client credential for one...')
    token = await exchangeForToken(config.host)
    console.log('  ✓ obtained a Bearer access token')
  }

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log('\nLocating the Templates folder...')
  const folderId = await findTemplatesFolderId(config.host, token)
  await sleep(config.delayMs)

  console.log('Fetching templates from signNow...\n')
  let templates = await listTemplates(config.host, token, folderId, config.delayMs)
  console.log(`Found ${templates.length} template(s).`)

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    const notFound = config.templateIds.filter((id) => !templates.some((t) => t.id === id))
    templates = templates.filter((t) => wanted.has(t.id))
    if (notFound.length) console.warn(`Warning: not found: ${notFound.join(', ')}`)
    console.log(`Filtered to ${templates.length} template(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.document_name || t.name} (${t.id})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const templateId = t.id
    const title = t.document_name || t.name || `template-${templateId}`
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)

    try {
      const detail = await getTemplateDetail(config.host, token, templateId)
      const roles = extractRoles(detail)
      const fields = extractFields(detail)

      await sleep(config.delayMs)
      const pdfBuffer = await apiGetBytes(
        config.host,
        `/document/${templateId}/download?type=collapsed`,
        token
      )
      const pdfFilename = `${sanitizeFilename(title)}.pdf`
      fs.writeFileSync(path.join(config.outputDir, pdfFilename), pdfBuffer)

      console.log(
        `  ✓ ${pdfFilename} (${(pdfBuffer.length / 1024).toFixed(1)} KB) — ${roles.length} role(s), ${fields.length} field(s)`
      )
      results.push({ templateId, title, pdfFilename, roles, fields, status: 'success' })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId, title, pdfFilename: '', roles: [], fields: [],
        status: 'error', error: err.message,
      })
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    apiHost: config.host,
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'signnow-template-manifest.json'),
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
  console.log(`\nManifest written to: ${path.join(config.outputDir, 'signnow-template-manifest.json')}`)
  console.log(`PDFs saved to: ${config.outputDir}`)
  console.log('\nNext steps:')
  console.log('  1. Upload the PDFs to Anvil with the anvil-document-sdk migrate-pdfs-to-anvil.ts script')
  console.log('     (use Document AI field detection), OR build a dynamic doc — see template-migration.md')
  console.log('  2. Re-tag fields and assign signers in the Anvil editor using the manifest (roles, fields)')
  console.log('  3. Build the template ID mapping (signNow templateId → Anvil castEid) for your DB migration')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
