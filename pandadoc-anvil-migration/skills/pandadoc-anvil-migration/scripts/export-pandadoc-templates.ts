#!/usr/bin/env npx ts-node
/**
 * PandaDoc Template Export Script
 *
 * PandaDoc templates are block/content-based — there is no flat-PDF export for a
 * template. To migrate one into Anvil you need (a) its structure (roles, fields,
 * tokens) and (b) a rendered PDF to use as the Anvil template's base document.
 *
 * This script, per template:
 *   1. Reads the template details (roles, fields, tokens) — GET /templates/{id}/details
 *   2. Instantiates a throwaway document from the template (never sent)
 *   3. Polls it to `document.draft`, then downloads its PDF — the base document
 *   4. Reads the instance's field geometry — GET /documents/{id}/fields
 *   5. Deletes the throwaway document (unless --keep-docs)
 *
 * Writes each `<title>.pdf` plus `pandadoc-template-manifest.json` describing
 * roles, fields (with geometry where available), and tokens — the input for the
 * Anvil import + field re-tagging step. See ../references/template-migration.md.
 *
 * Usage:
 *   npx ts-node export-pandadoc-templates.ts --output-dir ./migrated-templates
 *   npx ts-node export-pandadoc-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node export-pandadoc-templates.ts --output-dir ./out --dry-run
 *   npx ts-node export-pandadoc-templates.ts --output-dir ./out --keep-docs
 *
 * Requirements:
 *   PANDADOC_API_KEY set in the environment (or --api-key)
 *
 * Standalone — uses only `fetch` and Node's fs/path. NOTE: this creates (and by
 * default deletes) a throwaway document per template in your PandaDoc account so
 * it can render the PDF. Use a sandbox key if you'd rather not touch production.
 */

import * as fs from 'fs'
import * as path from 'path'

const API_BASE = 'https://api.pandadoc.com/public/v1'

interface ExportConfig {
  outputDir: string
  templateIds?: string[]
  apiKey?: string
  delayMs: number
  dryRun: boolean
  keepDocs: boolean
  pollTimeoutMs: number
}

interface ExportedTemplate {
  templateId: string
  title: string
  pdfFilename: string
  roles: Array<{ name: string; signingOrder: number | null }>
  fields: Array<{ name: string; type: string; assignedToRole: string | null; geometry: any | null }>
  tokens: Array<{ name: string }>
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `API-Key ${apiKey}`, 'Content-Type': 'application/json' }
}

async function apiJSON(method: string, endpoint: string, apiKey: string, body?: any): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: headers(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${method} ${endpoint} failed (HTTP ${res.status}): ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

async function apiBytes(endpoint: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}${endpoint}`, { headers: { Authorization: `API-Key ${apiKey}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`GET ${endpoint} failed (HTTP ${res.status}): ${text}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// PandaDoc reads
// ---------------------------------------------------------------------------

async function listAllTemplates(apiKey: string, delayMs: number): Promise<any[]> {
  const all: any[] = []
  let page = 1
  const count = 100
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await apiJSON('GET', `/templates?count=${count}&page=${page}`, apiKey)
    const results = res.results || []
    all.push(...results)
    if (results.length < count) break
    page++
    await sleep(delayMs)
  }
  return all
}

/** Instantiate a throwaway document from a template so we can render its PDF + read field geometry. */
async function createTempDocument(apiKey: string, templateId: string, roles: any[]): Promise<string> {
  // Every role needs a recipient; use placeholder addresses. The document is never sent.
  const recipients = (roles.length ? roles : [{ name: 'Signer' }]).map((r, i) => ({
    email: `migration+role${i}@example.com`,
    first_name: 'Migration',
    last_name: `Role${i}`,
    role: r.name,
  }))
  const created = await apiJSON('POST', '/documents', apiKey, {
    name: `[migration-export] ${templateId}`,
    template_uuid: templateId,
    recipients,
  })
  return created.id
}

async function pollToDraft(apiKey: string, docId: string, timeoutMs: number, delayMs: number): Promise<void> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const doc = await apiJSON('GET', `/documents/${docId}`, apiKey)
    if (doc.status === 'document.draft') return
    if (doc.status === 'document.error') throw new Error('Document creation errored in PandaDoc')
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for document.draft')
    await sleep(delayMs)
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
    delayMs: 700,
    dryRun: false,
    keepDocs: false,
    pollTimeoutMs: 60000,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir': config.outputDir = args[++i]; break
      case '--template-ids': config.templateIds = args[++i].split(',').map((s) => s.trim()); break
      case '--api-key': config.apiKey = args[++i]; break
      case '--delay': config.delayMs = parseInt(args[++i], 10); break
      case '--keep-docs': config.keepDocs = true; break
      case '--dry-run': config.dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node export-pandadoc-templates.ts [options]

Options:
  --output-dir <path>    Directory to save PDFs + manifest (required)
  --template-ids <ids>   Comma-separated template IDs (default: all)
  --api-key <key>        PandaDoc API key (or set PANDADOC_API_KEY)
  --delay <ms>           Delay between API calls (default 700)
  --keep-docs            Do not delete the throwaway documents used to render PDFs
  --dry-run              List templates without exporting
  --help                 Show this help

NOTE: rendering a template's PDF requires instantiating a throwaway document per
template (never sent, deleted afterward unless --keep-docs). Use a sandbox key to
avoid touching production.
        `)
        process.exit(0)
    }
  }

  const apiKey = config.apiKey ?? process.env.PANDADOC_API_KEY
  if (!apiKey) {
    console.error('Error: PANDADOC_API_KEY is required (or --api-key).')
    process.exit(1)
  }
  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  if (!config.dryRun) fs.mkdirSync(config.outputDir, { recursive: true })

  console.log('\nFetching templates from PandaDoc...\n')
  let templates = await listAllTemplates(apiKey, config.delayMs)
  console.log(`Found ${templates.length} template(s).`)

  if (config.templateIds?.length) {
    const wanted = new Set(config.templateIds)
    templates = templates.filter((t) => wanted.has(t.id))
    console.log(`Filtered to ${templates.length} template(s).`)
  }

  templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.id})`))

  if (config.dryRun) {
    console.log('\nDry run complete. Nothing exported.')
    return
  }

  const results: ExportedTemplate[] = []

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i]
    const templateId = t.id
    const title = t.name || `template-${templateId}`
    console.log(`\n[${i + 1}/${templates.length}] Exporting "${title}"...`)
    let tempDocId: string | undefined

    try {
      const details = await apiJSON('GET', `/templates/${templateId}/details`, apiKey)
      const roles = (details.roles || []).map((r: any) => ({
        name: r.name,
        signingOrder: r.signing_order ?? null,
      }))
      const tokens = (details.tokens || []).map((tok: any) => ({ name: tok.name }))

      // Render a base PDF by instantiating a throwaway document.
      await sleep(config.delayMs)
      tempDocId = await createTempDocument(apiKey, templateId, roles)
      await pollToDraft(apiKey, tempDocId, config.pollTimeoutMs, config.delayMs)

      const pdfBuffer = await apiBytes(`/documents/${tempDocId}/download`, apiKey)
      const pdfFilename = `${sanitizeFilename(title)}.pdf`
      fs.writeFileSync(path.join(config.outputDir, pdfFilename), pdfBuffer)

      // Read field geometry from the instance (tiered strategy: use real coords when present).
      let instanceFields: any[] = []
      try {
        const fieldsRes = await apiJSON('GET', `/documents/${tempDocId}/fields`, apiKey)
        instanceFields = fieldsRes.fields || fieldsRes || []
      } catch {
        // Some field placements resolve to geometry only on completed docs; tolerate absence.
      }

      const fields = (details.fields || []).map((f: any) => {
        const match = instanceFields.find(
          (inf: any) => inf.field_id === f.field_id || inf.uuid === f.uuid || inf.name === f.name
        )
        return {
          name: f.name || f.field_id,
          type: f.type,
          assignedToRole: f.assigned_to?.role ?? null,
          geometry: match?.layout ?? null,
        }
      })

      console.log(`  ✓ ${pdfFilename} — ${roles.length} role(s), ${fields.length} field(s), ${tokens.length} token(s)`)
      results.push({ templateId, title, pdfFilename, roles, fields, tokens, status: 'success' })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId, title, pdfFilename: '', roles: [], fields: [], tokens: [],
        status: 'error', error: err.message,
      })
    } finally {
      if (tempDocId && !config.keepDocs) {
        try {
          await apiJSON('DELETE', `/documents/${tempDocId}`, apiKey)
        } catch {
          console.log(`  (could not delete throwaway doc ${tempDocId} — remove it manually)`)
        }
      }
    }

    if (i < templates.length - 1) await sleep(config.delayMs)
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    templates: results,
  }
  fs.writeFileSync(
    path.join(config.outputDir, 'pandadoc-template-manifest.json'),
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
  console.log('  2. Re-tag fields and assign signers using the manifest (roles, fields, tokens)')
  console.log('  3. Publish each template and build your template ID mapping')
}

main().catch((err) => {
  console.error('Export failed:', err)
  process.exit(1)
})
