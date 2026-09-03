#!/usr/bin/env npx ts-node
/**
 * DocuSign JSON → Anvil Template Import Script
 *
 * Uploads the converter-shaped JSON produced by export-docusign-templates.ts to
 * Anvil's createCast endpoint as an `application/json` file. Anvil runs its
 * DocuSign JSON parser and creates an Anvil template (Cast) with field geometry,
 * field types, and signer roles reconstructed automatically.
 *
 * Writes `anvil-import-manifest.json` mapping each source JSON to its new castEid.
 *
 * Usage:
 *   npx ts-node import-docusign-json.ts --dir ./migrated-templates
 *   npx ts-node import-docusign-json.ts --dir ./out --org-eid <organizationEid>
 *   npx ts-node import-docusign-json.ts --dir ./out --dry-run
 *
 * Requirements:
 *   ANVIL_API_KEY set in the environment (or --api-key)
 *   npm install @anvilco/anvil
 *
 * The created Casts are DRAFTS — review and publish them in the Anvil dashboard
 * before using them in fillPDF / createEtchPacket.
 */

import * as fs from 'fs'
import * as path from 'path'
import Anvil from '@anvilco/anvil'

// Files in the output dir that are NOT templates to import.
const NON_TEMPLATE_JSON = new Set([
  'docusign-template-manifest.json',
  'anvil-import-manifest.json',
  'template-id-mapping.json',
])

const CREATE_CAST_MUTATION = `
  mutation CreateCast($organizationEid: String, $title: String, $file: Upload!, $isTemplate: Boolean) {
    createCast(organizationEid: $organizationEid, title: $title, file: $file, isTemplate: $isTemplate) {
      eid
      title
      config
    }
  }
`

interface ImportResult {
  jsonFilename: string
  title: string
  castEid: string
  fieldCount: number
  status: 'success' | 'error'
  error?: string
}

function titleFromFilename(filename: string): string {
  return path
    .basename(filename, '.json')
    .replace(/_/g, ' ')
    .trim()
}

function countConfigFields(config: any): number {
  const fields = config?.fields
  return Array.isArray(fields) ? fields.length : 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const args = process.argv.slice(2)
  let dir = ''
  let orgEid: string | undefined
  let apiKey: string | undefined
  let delayMs = 400
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir': dir = args[++i]; break
      case '--org-eid': orgEid = args[++i]; break
      case '--api-key': apiKey = args[++i]; break
      case '--delay': delayMs = parseInt(args[++i], 10); break
      case '--dry-run': dryRun = true; break
      case '--help':
        console.log(`
Usage: npx ts-node import-docusign-json.ts --dir <path> [options]

Options:
  --dir <path>       Directory of exported DocuSign JSON files (required)
  --org-eid <eid>    Anvil organization EID (optional if the API key is org-scoped)
  --api-key <key>    Anvil API key (or set ANVIL_API_KEY)
  --delay <ms>       Delay between uploads (default 400)
  --dry-run          List what would be imported without uploading
  --help             Show this help
        `)
        process.exit(0)
    }
  }

  if (!dir) {
    console.error('Error: --dir is required. Run with --help for usage.')
    process.exit(1)
  }
  const key = apiKey ?? process.env.ANVIL_API_KEY
  if (!key && !dryRun) {
    console.error('Error: ANVIL_API_KEY is required (or --api-key).')
    process.exit(1)
  }

  const jsonFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !NON_TEMPLATE_JSON.has(f))
    .sort()

  if (!jsonFiles.length) {
    console.error(`No template JSON files found in ${dir}.`)
    process.exit(1)
  }

  console.log(`\nFound ${jsonFiles.length} template JSON file(s) to import:\n`)
  jsonFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))

  if (dryRun) {
    console.log('\nDry run complete. Nothing uploaded.')
    return
  }

  const anvil = new Anvil({ apiKey: key })
  const results: ImportResult[] = []

  for (let i = 0; i < jsonFiles.length; i++) {
    const filename = jsonFiles[i]
    const title = titleFromFilename(filename)
    const buffer = fs.readFileSync(path.join(dir, filename))
    console.log(`\n[${i + 1}/${jsonFiles.length}] Importing "${title}"...`)

    try {
      const file = Anvil.prepareGraphQLFile(buffer, {
        filename,
        mimetype: 'application/json',
      })

      const { data, errors } = await anvil.requestGraphQL({
        query: CREATE_CAST_MUTATION,
        variables: { organizationEid: orgEid, title, file, isTemplate: true },
      })

      if (errors) throw new Error(JSON.stringify(errors))

      const cast = (data as any)?.data?.createCast
      if (!cast?.eid) throw new Error('createCast returned no eid')

      const fieldCount = countConfigFields(cast.config)
      console.log(`  ✓ castEid = ${cast.eid} — ${fieldCount} field(s)`)

      results.push({ jsonFilename: filename, title, castEid: cast.eid, fieldCount, status: 'success' })
    } catch (err: any) {
      console.log(`  ✗ Failed: ${err.message}`)
      results.push({ jsonFilename: filename, title, castEid: '', fieldCount: 0, status: 'error', error: err.message })
    }

    if (i < jsonFiles.length - 1) await sleep(delayMs)
  }

  const manifest = {
    importedAt: new Date().toISOString(),
    templates: results,
  }
  fs.writeFileSync(
    path.join(dir, 'anvil-import-manifest.json'),
    JSON.stringify(manifest, null, 2)
  )

  const ok = results.filter((r) => r.status === 'success')
  const failed = results.filter((r) => r.status === 'error')
  console.log('\n--- Import Summary ---')
  console.log(`  Imported: ${ok.length}/${results.length}`)
  if (failed.length) {
    console.log(`  Failed:   ${failed.length}`)
    failed.forEach((f) => console.log(`    - ${f.title}: ${f.error}`))
  }
  console.log(`\nManifest written to: ${path.join(dir, 'anvil-import-manifest.json')}`)
  console.log('\nNext steps:')
  console.log('  1. Open each new template in the Anvil dashboard, review fields, and PUBLISH it')
  console.log('  2. Combine the DocuSign + Anvil manifests into template-id-mapping.json')
  console.log('  3. Generate and run your database migration (see template-migration.md)')
}

main().catch((err) => {
  console.error('Import failed:', err)
  process.exit(1)
})
