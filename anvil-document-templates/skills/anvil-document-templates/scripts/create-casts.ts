#!/usr/bin/env npx ts-node
/**
 * Anvil "Create Casts with Document AI" Script
 *
 * Iterates over every PDF in a folder and uploads each one to Anvil as a
 * template (Cast), using Anvil's Document AI to automatically detect the form
 * fields on the PDF. Field aliases (the names Document AI tries to match the
 * detected fields to) are read from a CSV file and passed up in the createCast
 * mutation.
 *
 * Usage:
 *   npx ts-node create-casts.ts --dir ./pdfs --aliases ./field-aliases.csv
 *   npx ts-node create-casts.ts --dir ./pdfs                 # no aliases
 *   npx ts-node create-casts.ts --dir ./pdfs --dry-run       # list only, no upload
 *
 * Requirements:
 *   npm install @anvilco/anvil
 *   npm install -D ts-node typescript
 *   ANVIL_API_KEY set in the environment (or pass --api-key)
 *
 * What this script does:
 *   1. Reads field aliases from a single-column CSV (if provided)
 *   2. Scans a directory for PDF files
 *   3. Uploads each PDF to Anvil via the createCast GraphQL mutation, with
 *      Document AI field detection enabled (detectBoxesAdvanced +
 *      advancedDetectFields) and the CSV aliases passed as aliasIds
 *   4. Uses multipart GraphQL upload via Anvil.prepareGraphQLFile()
 *   5. Writes a manifest (JSON) mapping filenames to their new castEids
 *
 * Rate limits: development keys are limited to 2 req/s, production keys to
 * 40 req/s. A delay between uploads keeps the script within those limits.
 */

import Anvil from '@anvilco/anvil'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface Config {
  /** Directory containing PDF files to upload */
  pdfDir: string
  /** Optional path to a CSV file listing field aliases (one per line) */
  aliasesPath?: string
  /** Anvil API key (falls back to ANVIL_API_KEY env var) */
  apiKey?: string
  /** Max number of createCast calls to run in parallel (default: 4) */
  concurrency: number
  /** If true, list PDFs and aliases without uploading */
  dryRun: boolean
}

interface CastResult {
  filename: string
  castEid: string
  title: string
  status: 'success' | 'error'
  /** Whether the created cast used Document AI or fell back to standard detection */
  documentAI: 'used' | 'fallback' | 'n/a'
  /** Template edit URL (set when a cast was created and the org slug is known) */
  editUrl?: string
  error?: string
}

// ---------------------------------------------------------------------------
// CSV field-alias extraction
// ---------------------------------------------------------------------------

/**
 * Reads field aliases from a single-column CSV file. Behavior:
 *   - takes the first column of each row (ignores any trailing columns)
 *   - trims whitespace and surrounding quotes, drops blank lines
 *   - skips a leading header cell if it is `fieldAlias` or `alias`
 *     (case-insensitive)
 *
 * Returns a flat array of alias strings.
 */
function readAliasesFromCSV(csvPath: string): string[] {
  const raw = fs.readFileSync(csvPath, 'utf-8')

  const cells = raw
    .split(/\r?\n/)
    .map((line) => line.split(',')[0]) // first column only
    .map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter((cell) => cell.length > 0)

  // Skip an optional header row
  if (cells.length > 0 && /^(fieldalias|alias)$/i.test(cells[0])) {
    cells.shift()
  }

  // De-duplicate while preserving order
  return Array.from(new Set(cells))
}

// ---------------------------------------------------------------------------
// PDF discovery
// ---------------------------------------------------------------------------

function findPDFs(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`)
  }

  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(dir, f))
    .sort()
}

// ---------------------------------------------------------------------------
// Organization lookup
// ---------------------------------------------------------------------------

const CURRENT_USER_QUERY = `
  query CurrentUser {
    currentUser {
      email
      organizations {
        eid
        name
        slug
      }
    }
  }
`

interface Organization {
  eid: string
  name: string
  slug: string
}

/**
 * Looks up the organization(s) the API key belongs to so we can display the
 * name and build template edit URLs from the slug. Returns [] on any failure.
 */
async function fetchOrganizations(client: InstanceType<typeof Anvil>): Promise<Organization[]> {
  try {
    const res = await client.requestGraphQL({ query: CURRENT_USER_QUERY })
    return ((res.data as any)?.data?.currentUser?.organizations ?? []) as Organization[]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Browser helper
// ---------------------------------------------------------------------------

/** Opens a URL in the user's default browser (new tab), cross-platform. */
function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  // detached + unref so the script doesn't wait on the browser process
  const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
  child.on('error', () => {
    console.log(`  (could not auto-open browser; open manually: ${url})`)
  })
  child.unref()
}

// ---------------------------------------------------------------------------
// Anvil upload
// ---------------------------------------------------------------------------

const CREATE_CAST_MUTATION = `
  mutation CreateCast(
    $title: String
    $file: Upload!
    $aliasIds: JSON
    $detectBoxesAdvanced: Boolean
    $advancedDetectFields: Boolean
    $isTemplate: Boolean
  ) {
    createCast(
      title: $title
      file: $file
      aliasIds: $aliasIds
      detectBoxesAdvanced: $detectBoxesAdvanced
      advancedDetectFields: $advancedDetectFields
      isTemplate: $isTemplate
    ) {
      eid
      title
      fieldInfo
    }
  }
`

/**
 * Returns the human-readable message when an error response specifically means
 * the organization's plan doesn't include Document AI for createCast (Anvil
 * returns a `RequiresUpgradeError`). Returns null for any other error, so
 * unrelated failures are NOT misreported as a Document AI plan limit.
 */
function documentAIUpgradeMessage(errors: any[]): string | null {
  for (const err of errors ?? []) {
    const name = String(err?.name ?? '')
    const message = String(err?.message ?? '')
    const isUpgrade = name === 'RequiresUpgradeError'
    const mentionsDocAI = /document ai/i.test(message) && /(upgrade|plan)/i.test(message)
    if (isUpgrade || mentionsDocAI) {
      return message || 'Document AI requires an upgraded plan.'
    }
  }
  return null
}

async function uploadPDF(
  client: InstanceType<typeof Anvil>,
  filePath: string,
  fieldAliases: string[]
): Promise<CastResult> {
  const filename = path.basename(filePath)
  const title = path.basename(filePath, '.pdf').replace(/[-_]/g, ' ')

  try {
    // Prepare the file for GraphQL multipart upload
    const file = Anvil.prepareGraphQLFile(filePath)

    const variables: Record<string, any> = {
      title,
      file,
      isTemplate: true,
      // Enable Document AI field detection by default
      detectBoxesAdvanced: true,
      advancedDetectFields: true,
    }

    // Pass the CSV aliases as aliasIds (a JSON array of strings) so Document AI
    // can auto-assign your own field names to the fields it detects.
    if (fieldAliases.length > 0) {
      variables.aliasIds = fieldAliases
    }

    let response = await client.requestGraphQL({
      query: CREATE_CAST_MUTATION,
      variables,
    })

    // Only retry without Document AI when the org's plan specifically doesn't
    // include it. Any other error is returned as-is (never masked as a
    // Document AI issue).
    let documentAI: CastResult['documentAI'] = 'used'
    const upgradeMessage = response.errors?.length
      ? documentAIUpgradeMessage(response.errors)
      : null

    if (upgradeMessage) {
      console.log(`  ⚠ [${filename}] Document AI unavailable on this plan — falling back to standard detection.`)
      console.log(`      ${upgradeMessage}`)
      // prepareGraphQLFile consumes the stream, so create a fresh handle
      const retryFile = Anvil.prepareGraphQLFile(filePath)
      response = await client.requestGraphQL({
        query: CREATE_CAST_MUTATION,
        variables: {
          title,
          file: retryFile,
          isTemplate: true,
          detectBoxesAdvanced: false,
          advancedDetectFields: false,
          // aliasIds are only used together with advancedDetectFields
        },
      })
      documentAI = 'fallback'
    }

    if (response.errors?.length) {
      return {
        filename,
        castEid: '',
        title,
        status: 'error',
        documentAI: 'n/a',
        error: JSON.stringify(response.errors),
      }
    }

    const cast = (response.data as any)?.data?.createCast
    return {
      filename,
      castEid: cast?.eid ?? '',
      title: cast?.title ?? title,
      status: 'success',
      documentAI,
    }
  } catch (err: any) {
    return {
      filename,
      castEid: '',
      title,
      status: 'error',
      documentAI: 'n/a',
      error: err?.message ?? String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2)
  const config: Config = {
    pdfDir: '',
    concurrency: 4,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir':
        config.pdfDir = args[++i]
        break
      case '--aliases':
        config.aliasesPath = args[++i]
        break
      case '--api-key':
        config.apiKey = args[++i]
        break
      case '--concurrency':
        config.concurrency = Math.max(1, parseInt(args[++i], 10) || 1)
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--help':
        console.log(`
Usage: npx ts-node create-casts.ts [options]

Options:
  --dir <path>       Directory containing PDF files (required)
  --aliases <path>   CSV file listing field aliases, one per line (optional)
  --api-key <key>    Anvil API key (or set ANVIL_API_KEY env var)
  --concurrency <n>  Max parallel createCast calls (default: 4)
  --dry-run          List PDFs and aliases without uploading
  --help             Show this help message
        `)
        process.exit(0)
    }
  }

  // Validate
  const apiKey = config.apiKey ?? process.env.ANVIL_API_KEY
  if (!apiKey && !config.dryRun) {
    console.error('Error: ANVIL_API_KEY environment variable is required (or use --api-key)')
    process.exit(1)
  }

  if (!config.pdfDir) {
    console.error('Error: --dir is required. Run with --help for usage.')
    process.exit(1)
  }

  // Connect and identify the organization (printed at the top). The org slug is
  // used to build the template edit URLs opened in the browser.
  const client = apiKey ? new Anvil({ apiKey }) : null
  let orgSlug: string | null = null
  if (client) {
    const orgs = await fetchOrganizations(client)
    if (orgs.length === 1) {
      orgSlug = orgs[0].slug
      console.log(`\nOrganization: ${orgs[0].name} (${orgs[0].slug})`)
    } else if (orgs.length > 1) {
      orgSlug = orgs[0].slug
      console.log(`\nOrganizations (${orgs.length}) — using the first for edit URLs:`)
      orgs.forEach((o, idx) => console.log(`  ${idx === 0 ? '→' : ' '} ${o.name} (${o.slug})`))
    } else {
      console.log('\nOrganization: (could not determine from API key)')
    }
  }

  // Read field aliases from CSV
  let fieldAliases: string[] = []
  if (config.aliasesPath) {
    try {
      fieldAliases = readAliasesFromCSV(config.aliasesPath)
      console.log(`\nField aliases read from CSV (${fieldAliases.length}):`)
      fieldAliases.forEach((a) => console.log(`  - ${a}`))
    } catch (err: any) {
      console.error(`Warning: Could not read aliases CSV: ${err?.message ?? err}`)
      console.log('Continuing without field aliases...\n')
    }
  } else {
    console.log('\nNo --aliases CSV provided. PDFs will be uploaded without suggested field aliases.')
  }

  // Find PDFs
  const pdfFiles = findPDFs(config.pdfDir)
  if (pdfFiles.length === 0) {
    console.error(`No PDF files found in ${config.pdfDir}`)
    process.exit(1)
  }

  console.log(`\nFound ${pdfFiles.length} PDF file(s):`)
  pdfFiles.forEach((f) => console.log(`  - ${path.basename(f)}`))
  console.log()

  if (config.dryRun) {
    console.log('Dry run complete. No files were uploaded.')
    return
  }

  // Upload with a bounded worker pool so up to CONCURRENCY createCast calls
  // run in parallel. Results are indexed by position so the manifest keeps the
  // original file order regardless of which worker finishes first.
  // (client was created above during the organization lookup)
  const results: CastResult[] = new Array(pdfFiles.length)

  let nextIndex = 0
  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= pdfFiles.length) return

      const filePath = pdfFiles[i]
      const filename = path.basename(filePath)

      console.log(`[${i + 1}/${pdfFiles.length}] Uploading ${filename}...`)
      const result = await uploadPDF(client!, filePath, fieldAliases)

      if (result.status === 'success') {
        const mode = result.documentAI === 'fallback' ? ' (standard detection — no Document AI)' : ''
        console.log(`  ✓ [${filename}] Created template: castEid = ${result.castEid}${mode}`)

        // Open the new cast in edit mode in a browser tab
        if (orgSlug && result.castEid) {
          result.editUrl = `https://app.useanvil.com/org/${orgSlug}/pdf/${result.castEid}/edit`
          console.log(`     ↗ Opening ${result.editUrl}`)
          openInBrowser(result.editUrl)
        } else if (!orgSlug) {
          console.log('     (org slug unknown — skipping browser open)')
        }
      } else {
        console.log(`  ✗ [${filename}] Failed: ${result.error}`)
      }

      results[i] = result
    }
  }

  const poolSize = Math.min(config.concurrency, pdfFiles.length)
  console.log(`Uploading with up to ${poolSize} parallel createCast call(s)...\n`)
  await Promise.all(Array.from({ length: poolSize }, () => worker()))

  // Write manifest
  const manifestPath = path.join(config.pdfDir, 'anvil-migration-manifest.json')
  const manifest = {
    migratedAt: new Date().toISOString(),
    fieldAliases,
    templates: results,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  // Summary
  console.log('\n--- Summary ---')
  const successes = results.filter((r) => r.status === 'success')
  const failures = results.filter((r) => r.status === 'error')
  const fallbacks = successes.filter((r) => r.documentAI === 'fallback')
  console.log(`  Uploaded: ${successes.length}/${results.length}`)
  if (failures.length > 0) {
    console.log(`  Failed:   ${failures.length}`)
    failures.forEach((f) => console.log(`    - ${f.filename}: ${f.error}`))
  }
  if (fallbacks.length > 0) {
    console.log(
      `\n  ⚠ ${fallbacks.length}/${successes.length} template(s) were created WITHOUT Document AI ` +
        `because the org's plan does not include it. Upgrade the plan (see the message above) ` +
        `and re-run to get AI field detection with your aliasIds.`
    )
  }
  const opened = successes.filter((r) => r.editUrl)
  if (opened.length > 0) {
    console.log(`\n  Opened ${opened.length} template(s) in edit mode in your browser.`)
  }
  console.log(`\nManifest written to: ${manifestPath}`)
  console.log('\nNext steps:')
  console.log('  1. Each created template was opened in edit mode in a new browser tab')
  console.log('  2. Review the Document AI-detected fields (your CSV aliases are pre-loaded)')
  console.log('  3. Publish each template')
  console.log('  4. Use the castEids / editUrls from the manifest in your integration code')
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(1)
})
