#!/usr/bin/env npx ts-node
/**
 * DropboxSign Template Download Script
 *
 * Downloads templates from DropboxSign (formerly HelloSign) as PDFs and
 * generates a manifest with template metadata for migration to Anvil.
 *
 * Usage:
 *   npx ts-node migrate-dropboxsign-templates.ts --output-dir ./migrated-templates
 *   npx ts-node migrate-dropboxsign-templates.ts --output-dir ./out --template-ids "id1,id2"
 *   npx ts-node migrate-dropboxsign-templates.ts --output-dir ./out --dry-run
 *
 * Requirements:
 *   DROPBOX_SIGN_API_KEY set in environment (or .env file)
 *
 * What this script does:
 *   1. Lists all templates from your DropboxSign account (or specific ones)
 *   2. Downloads each template as a PDF file
 *   3. Generates a manifest (JSON) with template metadata — IDs, titles, roles,
 *      and merge fields — for use in the Anvil migration process
 *
 * This script is standalone — it uses fetch and has no external dependencies.
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DROPBOX_SIGN_API_BASE = 'https://api.hellosign.com/v3'

interface DownloadConfig {
  /** Directory to save downloaded PDFs and manifest */
  outputDir: string
  /** Optional: comma-separated template IDs to download (default: all) */
  templateIds?: string[]
  /** API key (falls back to DROPBOX_SIGN_API_KEY env var) */
  apiKey?: string
  /** Delay between API calls in ms (default: 500ms) */
  delayMs: number
  /** If true, list templates without downloading */
  dryRun: boolean
}

interface TemplateRole {
  name: string
  order: number | null
}

interface MergeField {
  name: string
  type: string
}

interface TemplateResult {
  templateId: string
  title: string
  filename: string
  roles: TemplateRole[]
  mergeFields: MergeField[]
  status: 'success' | 'error' | 'skipped'
  error?: string
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(apiKey + ':').toString('base64')
}

async function apiGet(
  apiKey: string,
  endpoint: string
): Promise<{ ok: boolean; status: number; data?: any; buffer?: Buffer }> {
  const url = `${DROPBOX_SIGN_API_BASE}${endpoint}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader(apiKey),
    },
  })

  if (!response.ok) {
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch {
      errorBody = response.statusText
    }
    return { ok: false, status: response.status, data: errorBody }
  }

  return { ok: true, status: response.status, data: response }
}

async function listTemplates(
  apiKey: string,
  page: number = 1,
  pageSize: number = 100
): Promise<{ templates: any[]; numPages: number }> {
  const result = await apiGet(
    apiKey,
    `/template/list?page=${page}&page_size=${pageSize}`
  )

  if (!result.ok) {
    throw new Error(
      `Failed to list templates (HTTP ${result.status}): ${JSON.stringify(result.data)}`
    )
  }

  const json = await result.data.json()
  return {
    templates: json.templates || [],
    numPages: json.list_info?.num_pages || 1,
  }
}

async function downloadTemplatePDF(
  apiKey: string,
  templateId: string
): Promise<Buffer> {
  const url = `${DROPBOX_SIGN_API_BASE}/template/files/${templateId}?file_type=pdf`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader(apiKey),
    },
  })

  if (!response.ok) {
    let errorBody: string
    try {
      errorBody = await response.text()
    } catch {
      errorBody = response.statusText
    }
    throw new Error(
      `Failed to download template ${templateId} (HTTP ${response.status}): ${errorBody}`
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(title: string): string {
  return title
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
  // Parse CLI args
  const args = process.argv.slice(2)
  const config: DownloadConfig = {
    outputDir: '',
    delayMs: 500,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output-dir':
        config.outputDir = args[++i]
        break
      case '--template-ids':
        config.templateIds = args[++i].split(',').map((id) => id.trim())
        break
      case '--api-key':
        config.apiKey = args[++i]
        break
      case '--delay':
        config.delayMs = parseInt(args[++i], 10)
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--help':
        console.log(`
Usage: npx ts-node migrate-dropboxsign-templates.ts [options]

Options:
  --output-dir <path>       Directory to save PDFs and manifest (required)
  --template-ids <ids>      Comma-separated template IDs to download (optional, default: all)
  --api-key <key>           DropboxSign API key (or set DROPBOX_SIGN_API_KEY env var)
  --delay <ms>              Delay between API calls in ms (default: 500)
  --dry-run                 List templates without downloading
  --help                    Show this help message
        `)
        process.exit(0)
    }
  }

  // Validate
  const apiKey = config.apiKey ?? process.env.DROPBOX_SIGN_API_KEY
  if (!apiKey) {
    console.error(
      'Error: DROPBOX_SIGN_API_KEY environment variable is required (or use --api-key)'
    )
    process.exit(1)
  }

  if (!config.outputDir) {
    console.error('Error: --output-dir is required. Run with --help for usage.')
    process.exit(1)
  }

  // Create output directory
  if (!config.dryRun) {
    fs.mkdirSync(config.outputDir, { recursive: true })
  }

  // Fetch all templates
  console.log('\nFetching templates from DropboxSign...\n')

  let allTemplates: any[] = []
  let page = 1
  let numPages = 1

  do {
    const result = await listTemplates(apiKey, page)
    allTemplates = allTemplates.concat(result.templates)
    numPages = result.numPages
    page++

    if (page <= numPages) {
      await sleep(config.delayMs)
    }
  } while (page <= numPages)

  console.log(`Found ${allTemplates.length} template(s) in DropboxSign.\n`)

  // Filter to specific templates if requested
  let templatesToProcess = allTemplates
  if (config.templateIds && config.templateIds.length > 0) {
    templatesToProcess = allTemplates.filter((t) =>
      config.templateIds!.includes(t.template_id)
    )

    const notFound = config.templateIds.filter(
      (id) => !allTemplates.find((t) => t.template_id === id)
    )
    if (notFound.length > 0) {
      console.warn(`Warning: Template IDs not found: ${notFound.join(', ')}\n`)
    }

    console.log(
      `Filtered to ${templatesToProcess.length} template(s) matching provided IDs.\n`
    )
  }

  // List templates
  templatesToProcess.forEach((t, i) => {
    const roles = (t.signer_roles || []).map((r: any) => r.name).join(', ')
    console.log(`  ${i + 1}. ${t.title} (${t.template_id})`)
    if (roles) console.log(`     Roles: ${roles}`)
  })
  console.log()

  if (config.dryRun) {
    console.log('Dry run complete. No files were downloaded.')
    return
  }

  // Download each template
  const results: TemplateResult[] = []

  for (let i = 0; i < templatesToProcess.length; i++) {
    const template = templatesToProcess[i]
    const templateId = template.template_id
    const title = template.title || `template-${templateId}`
    const filename = `${sanitizeFilename(title)}.pdf`
    const outputPath = path.join(config.outputDir, filename)

    console.log(
      `[${i + 1}/${templatesToProcess.length}] Downloading "${title}"...`
    )

    try {
      const pdfBuffer = await downloadTemplatePDF(apiKey, templateId)
      fs.writeFileSync(outputPath, pdfBuffer)
      console.log(`  ✓ Saved: ${filename} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)

      results.push({
        templateId,
        title,
        filename,
        roles: (template.signer_roles || []).map((r: any) => ({
          name: r.name,
          order: r.order ?? null,
        })),
        mergeFields: (template.custom_fields || []).map((f: any) => ({
          name: f.name,
          type: f.type || 'text',
        })),
        status: 'success',
      })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({
        templateId,
        title,
        filename,
        roles: [],
        mergeFields: [],
        status: 'error',
        error: err.message,
      })
    }

    // Rate limit delay
    if (i < templatesToProcess.length - 1) {
      await sleep(config.delayMs)
    }
  }

  // Write manifest
  const manifestPath = path.join(config.outputDir, 'dropboxsign-template-manifest.json')
  const manifest = {
    downloadedAt: new Date().toISOString(),
    sourceApiKey: apiKey.substring(0, 8) + '...',
    templates: results,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  // Summary
  console.log('\n--- Download Summary ---')
  const successes = results.filter((r) => r.status === 'success')
  const failures = results.filter((r) => r.status === 'error')
  console.log(`  Downloaded: ${successes.length}/${results.length}`)
  if (failures.length > 0) {
    console.log(`  Failed:     ${failures.length}`)
    failures.forEach((f) => console.log(`    - ${f.title}: ${f.error}`))
  }
  console.log(`\nManifest written to: ${manifestPath}`)
  console.log(`PDFs saved to: ${config.outputDir}`)
  console.log('\nNext steps:')
  console.log('  1. Upload these PDFs to Anvil using migrate-pdfs-to-anvil.ts')
  console.log('  2. Map fields and roles in the Anvil template editor')
  console.log('  3. Create the template ID mapping for database migration')
}

main().catch((err) => {
  console.error('Download failed:', err)
  process.exit(1)
})
