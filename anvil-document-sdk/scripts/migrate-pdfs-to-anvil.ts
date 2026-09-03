#!/usr/bin/env npx ts-node
/**
 * Anvil PDF Migration Script
 *
 * Uploads local PDF files to Anvil as templates (Casts), optionally seeding
 * field aliases from your application's data schema so that Anvil's tagging
 * UI starts pre-populated with meaningful names.
 *
 * Usage:
 *   npx ts-node migrate-pdfs-to-anvil.ts --dir ./pdfs --schema ./schema.json
 *   npx ts-node migrate-pdfs-to-anvil.ts --dir ./pdfs              # no schema
 *
 * Requirements:
 *   npm install @anvilco/anvil
 *   ANVIL_API_KEY set in environment (or .env file)
 *
 * What this script does:
 *   1. Reads your data schema (if provided) and extracts field keys
 *   2. Scans a directory for PDF files
 *   3. Uploads each PDF to Anvil via the createCast GraphQL mutation
 *   4. Passes your schema keys as suggested field aliases so Anvil can
 *      accelerate template tagging
 *   5. Outputs a manifest (JSON) mapping filenames to their new castEids
 *
 * After running this script, open each template in the Anvil dashboard to
 * review and publish it. The field aliases you provided will appear as
 * suggestions when tagging fields in the visual editor.
 *
 * Rate limits: Development keys are limited to 2 req/s, production keys
 * to 40 req/s. This script adds a delay between uploads to stay within limits.
 */

import Anvil from '@anvilco/anvil'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface MigrationConfig {
  /** Directory containing PDF files to upload */
  pdfDir: string
  /** Optional path to a JSON schema file with field keys */
  schemaPath?: string
  /** Anvil API key (falls back to ANVIL_API_KEY env var) */
  apiKey?: string
  /** Delay between uploads in ms (default: 500ms to respect rate limits) */
  delayMs?: number
  /** If true, do a dry run without uploading */
  dryRun?: boolean
}

interface CastResult {
  filename: string
  castEid: string
  title: string
  status: 'success' | 'error'
  error?: string
}

// ---------------------------------------------------------------------------
// Schema extraction
// ---------------------------------------------------------------------------

/**
 * Reads a JSON schema file and extracts field keys to use as Anvil field
 * aliases. Supports several common formats:
 *
 *   - Flat object:    { "firstName": "string", "lastName": "string" }
 *   - Array of keys:  ["firstName", "lastName", "email"]
 *   - Prisma-style:   { "model": { "fields": { "firstName": {...} } } }
 *   - JSON Schema:    { "properties": { "firstName": { "type": "string" } } }
 *   - Sequelize:      { "firstName": { "type": "DataTypes.STRING" } }
 *
 * Returns a flat array of string keys.
 */
function extractSchemaKeys(schemaPath: string): string[] {
  const raw = fs.readFileSync(schemaPath, 'utf-8')
  const parsed = JSON.parse(raw)

  // Array of strings
  if (Array.isArray(parsed)) {
    return parsed.filter((k) => typeof k === 'string')
  }

  // JSON Schema style — { properties: { ... } }
  if (parsed.properties && typeof parsed.properties === 'object') {
    return Object.keys(parsed.properties)
  }

  // Prisma-style — { model: { fields: { ... } } }
  if (parsed.model?.fields && typeof parsed.model.fields === 'object') {
    return Object.keys(parsed.model.fields)
  }

  // Flat object — keys are field names
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed)
  }

  return []
}

// ---------------------------------------------------------------------------
// PDF discovery
// ---------------------------------------------------------------------------

function findPDFs(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`)
  }

  const files = fs.readdirSync(dir)
  return files
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(dir, f))
    .sort()
}

// ---------------------------------------------------------------------------
// Anvil upload
// ---------------------------------------------------------------------------

const CREATE_CAST_MUTATION = `
  mutation CreateCast(
    $title: String
    $file: Upload!
    $fieldAliases: [JSON!]
    $detectBoxesAdvanced: Boolean
    $advancedDetectFields: Boolean
    $isTemplate: Boolean
  ) {
    createCast(
      title: $title
      file: $file
      fieldAliases: $fieldAliases
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
 * Checks whether an error response indicates that AI detection features
 * (detectBoxesAdvanced / advancedDetectFields) are not enabled on the
 * organization. If so, the upload should be retried without those flags.
 */
function isAIDetectionNotEnabledError(errors: any[]): boolean {
  const msg = JSON.stringify(errors).toLowerCase()
  return (
    msg.includes('not enabled') ||
    msg.includes('not available') ||
    msg.includes('advanced detect') ||
    msg.includes('detectboxesadvanced') ||
    msg.includes('advanceddetectfields') ||
    msg.includes('feature') ||
    msg.includes('plan')
  )
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
      // Enable AI-powered field detection by default
      detectBoxesAdvanced: true,
      advancedDetectFields: true,
    }

    // Only pass fieldAliases when advancedDetectFields is enabled
    if (fieldAliases.length > 0) {
      variables.fieldAliases = fieldAliases.map((alias) => ({
        fieldAlias: alias,
      }))
    }

    let response = await client.requestGraphQL({
      query: CREATE_CAST_MUTATION,
      variables,
    })

    // If AI detection is not enabled on the org, retry without those flags
    if (response.errors?.length && isAIDetectionNotEnabledError(response.errors)) {
      console.log(`  ⚠ AI detection not enabled — retrying without advanced detection flags...`)
      const retryFile = Anvil.prepareGraphQLFile(filePath)
      const retryVariables: Record<string, any> = {
        title,
        file: retryFile,
        isTemplate: true,
        detectBoxesAdvanced: false,
        advancedDetectFields: false,
      }

      // Without advancedDetectFields, don't pass fieldAliases
      // (they are only used in conjunction with AI detection)

      response = await client.requestGraphQL({
        query: CREATE_CAST_MUTATION,
        variables: retryVariables,
      })
    }

    if (response.errors?.length) {
      return {
        filename,
        castEid: '',
        title,
        status: 'error',
        error: JSON.stringify(response.errors),
      }
    }

    const cast = response.data?.data?.createCast
    return {
      filename,
      castEid: cast?.eid ?? '',
      title: cast?.title ?? title,
      status: 'success',
    }
  } catch (err: any) {
    return {
      filename,
      castEid: '',
      title,
      status: 'error',
      error: err.message ?? String(err),
    }
  }
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
  const config: MigrationConfig = {
    pdfDir: '',
    delayMs: 500,
    dryRun: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir':
        config.pdfDir = args[++i]
        break
      case '--schema':
        config.schemaPath = args[++i]
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
Usage: npx ts-node migrate-pdfs-to-anvil.ts [options]

Options:
  --dir <path>       Directory containing PDF files (required)
  --schema <path>    Path to JSON schema file with field keys (optional)
  --api-key <key>    Anvil API key (or set ANVIL_API_KEY env var)
  --delay <ms>       Delay between uploads in ms (default: 500)
  --dry-run          List PDFs without uploading
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

  // Extract schema keys
  let fieldAliases: string[] = []
  if (config.schemaPath) {
    try {
      fieldAliases = extractSchemaKeys(config.schemaPath)
      console.log(`\nSchema keys extracted (${fieldAliases.length}):`)
      fieldAliases.forEach((k) => console.log(`  - ${k}`))
    } catch (err: any) {
      console.error(`Warning: Could not read schema file: ${err.message}`)
      console.log('Continuing without field aliases...\n')
    }
  } else {
    console.log('\nNo schema file provided. PDFs will be uploaded without suggested field aliases.')
    console.log('You can still tag fields manually in the Anvil dashboard.\n')
  }

  // Find PDFs
  const pdfFiles = findPDFs(config.pdfDir)
  if (pdfFiles.length === 0) {
    console.error(`No PDF files found in ${config.pdfDir}`)
    process.exit(1)
  }

  console.log(`Found ${pdfFiles.length} PDF file(s):`)
  pdfFiles.forEach((f) => console.log(`  - ${path.basename(f)}`))
  console.log()

  if (config.dryRun) {
    console.log('Dry run complete. No files were uploaded.')
    return
  }

  // Upload
  const client = new Anvil({ apiKey: apiKey! })
  const results: CastResult[] = []

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i]
    const filename = path.basename(filePath)

    console.log(`[${i + 1}/${pdfFiles.length}] Uploading ${filename}...`)
    const result = await uploadPDF(client, filePath, fieldAliases)

    if (result.status === 'success') {
      console.log(`  ✓ Created template: castEid = ${result.castEid}`)
    } else {
      console.log(`  ✗ Failed: ${result.error}`)
    }

    results.push(result)

    // Rate limit delay between uploads
    if (i < pdfFiles.length - 1) {
      await sleep(config.delayMs ?? 500)
    }
  }

  // Write manifest
  const manifestPath = path.join(config.pdfDir, 'anvil-migration-manifest.json')
  const manifest = {
    migratedAt: new Date().toISOString(),
    fieldAliases,
    templates: results,
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  // Summary
  console.log('\n--- Migration Summary ---')
  const successes = results.filter((r) => r.status === 'success')
  const failures = results.filter((r) => r.status === 'error')
  console.log(`  Uploaded: ${successes.length}/${results.length}`)
  if (failures.length > 0) {
    console.log(`  Failed:   ${failures.length}`)
    failures.forEach((f) => console.log(`    - ${f.filename}: ${f.error}`))
  }
  console.log(`\nManifest written to: ${manifestPath}`)
  console.log('\nNext steps:')
  console.log('  1. Open each template in the Anvil dashboard')
  console.log('  2. Review and adjust field tagging (your schema keys are pre-loaded as aliases)')
  console.log('  3. Publish each template')
  console.log('  4. Use the castEids from the manifest in your integration code')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
