# Template Migration Reference

Step-by-step guide for migrating templates from DropboxSign to Anvil. This process uses two scripts: a bundled download script for DropboxSign and the `anvil-document-sdk` plugin's upload script for Anvil.

---

## Overview

1. Inventory templates from DropboxSign
2. Download templates as PDFs using the bundled script
3. Upload PDFs to Anvil using `anvil-document-sdk`'s script
4. Map fields (merge fields → field aliases, roles → signer IDs)
5. Create old → new ID mapping
6. Generate a database migration script
7. Developer runs the DB migration
8. Publish templates in the Anvil dashboard

---

## Step 1: Inventory Templates

Before downloading, get a list of all templates from DropboxSign to understand what needs to migrate.

The bundled `scripts/migrate-dropboxsign-templates.ts` handles this automatically, but you can also manually query:

```bash
curl -u "$DROPBOX_SIGN_API_KEY:" \
  "https://api.hellosign.com/v3/template/list?page_size=100"
```

For each template, note:
- **Template ID** — needed for download and ID mapping
- **Title** — to identify templates in Anvil
- **Roles** — will map to Anvil signer IDs
- **Merge fields** — will map to Anvil field aliases
- **Active usage** — is this template still in use?

Ask the developer: **"Do you want to migrate all templates, or just specific ones? If some are deprecated or unused, we can skip them."**

---

## Step 2: Download Templates as PDFs

Use the bundled `scripts/migrate-dropboxsign-templates.ts`:

```bash
# Download all templates
npx ts-node scripts/migrate-dropboxsign-templates.ts \
  --output-dir ./migrated-templates

# Download specific templates only
npx ts-node scripts/migrate-dropboxsign-templates.ts \
  --output-dir ./migrated-templates \
  --template-ids "tmpl_abc123,tmpl_def456"

# Dry run — list templates without downloading
npx ts-node scripts/migrate-dropboxsign-templates.ts \
  --output-dir ./migrated-templates \
  --dry-run
```

The script generates `dropboxsign-template-manifest.json`:

```json
{
  "downloadedAt": "2026-03-17T...",
  "templates": [
    {
      "templateId": "tmpl_abc123",
      "title": "NDA Template",
      "filename": "NDA_Template.pdf",
      "roles": [
        { "name": "Client", "order": 1 },
        { "name": "Manager", "order": 2 }
      ],
      "mergeFields": [
        { "name": "company_name", "type": "text" },
        { "name": "effective_date", "type": "text" }
      ],
      "status": "success"
    }
  ]
}
```

---

## Step 3: Upload to Anvil

Use the `anvil-document-sdk` plugin's `scripts/migrate-pdfs-to-anvil.ts`:

```bash
# With field alias suggestions from your schema
npx ts-node scripts/migrate-pdfs-to-anvil.ts \
  --dir ./migrated-templates \
  --schema ./extracted-schema.json

# Without schema
npx ts-node scripts/migrate-pdfs-to-anvil.ts \
  --dir ./migrated-templates
```

This generates `anvil-migration-manifest.json` in the output directory with `castEid` values for each uploaded template.

---

## Step 4: Map Fields

For each migrated template, create a field mapping:

### Merge fields → Field aliases

DropboxSign merge fields become Anvil field aliases in `data.payloads`:

| DropboxSign Merge Field | Anvil Field Alias | Notes |
|------------------------|-------------------|-------|
| `company_name` | `companyName` | Rename to camelCase if desired |
| `effective_date` | `effectiveDate` | |
| `employee_name` | `employeeName` | |

Set these aliases in the Anvil template editor. If you used the schema extraction during upload, they may already be pre-populated.

### Roles → Signer IDs

DropboxSign roles become Anvil signer IDs:

| DropboxSign Role | Anvil Signer ID | Signing Order |
|-----------------|-----------------|---------------|
| `Client` | `client` | 1 |
| `Manager` | `manager` | 2 |

In the Anvil template editor, assign signature fields to the appropriate signer IDs.

---

## Step 5: Create ID Mapping

Combine the DropboxSign manifest and Anvil manifest to create a mapping file:

```json
{
  "mappings": [
    {
      "dropboxSignTemplateId": "tmpl_abc123",
      "dropboxSignTitle": "NDA Template",
      "anvilCastEid": "xyz789...",
      "anvilTitle": "NDA Template",
      "roleMappings": {
        "Client": "client",
        "Manager": "manager"
      },
      "fieldMappings": {
        "company_name": "companyName",
        "effective_date": "effectiveDate"
      }
    }
  ]
}
```

Save this as `template-id-mapping.json` in the project root. This file drives the database migration and code updates.

---

## Step 6: Generate Database Migration

Detect the developer's migration framework and generate an appropriate migration script.

### Detection strategy

Search for:
- `prisma/schema.prisma` → Prisma
- `knexfile.js` or `knexfile.ts` → Knex
- Files matching `migrations/*-create-*.js` with `queryInterface` → Sequelize
- `ormconfig.ts` or `data-source.ts` with TypeORM imports → TypeORM
- None of the above → Raw SQL

### Example: Prisma migration

```prisma
// Add to schema.prisma
model SigningRequest {
  // ... existing fields ...
  hellosignTemplateId  String?  // existing — keep until verified
  signatureRequestId   String?  // existing — keep until verified
  castEid              String?  // new Anvil template EID
  etchPacketEid        String?  // new Anvil packet EID
}
```

Then generate a data migration to populate `castEid` from the ID mapping:

```typescript
import { PrismaClient } from '@prisma/client'
import mappings from './template-id-mapping.json'

const prisma = new PrismaClient()

async function migrate() {
  for (const mapping of mappings.mappings) {
    await prisma.signingRequest.updateMany({
      where: { hellosignTemplateId: mapping.dropboxSignTemplateId },
      data: { castEid: mapping.anvilCastEid },
    })
    console.log(`Mapped ${mapping.dropboxSignTitle}: ${mapping.dropboxSignTemplateId} → ${mapping.anvilCastEid}`)
  }
}

migrate().then(() => prisma.$disconnect())
```

### Example: Knex migration

```typescript
import { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('signing_requests', (table) => {
    table.string('cast_eid').nullable()
    table.string('etch_packet_eid').nullable()
  })

  // Populate from ID mapping
  const mappings = [
    { old: 'tmpl_abc123', new: 'xyz789...' },
    // ... generated from template-id-mapping.json
  ]

  for (const m of mappings) {
    await knex('signing_requests')
      .where('hellosign_template_id', m.old)
      .update({ cast_eid: m.new })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('signing_requests', (table) => {
    table.dropColumn('cast_eid')
    table.dropColumn('etch_packet_eid')
  })
}
```

### Example: Raw SQL

```sql
-- Add Anvil EID columns
ALTER TABLE signing_requests ADD COLUMN cast_eid VARCHAR(255);
ALTER TABLE signing_requests ADD COLUMN etch_packet_eid VARCHAR(255);

-- Populate from ID mapping
UPDATE signing_requests SET cast_eid = 'xyz789...' WHERE hellosign_template_id = 'tmpl_abc123';
-- ... one UPDATE per mapping entry
```

---

## Step 7: Developer Runs the Migration

**Do not run the migration automatically.** Present the generated migration to the developer and let them review and run it:

**"I've generated the database migration at [path]. It:**
1. **Adds columns:** `cast_eid` and `etch_packet_eid` alongside your existing DropboxSign columns
2. **Populates data:** Maps old template IDs to new Anvil castEids based on the migration manifest
3. **Preserves old columns:** Your existing DropboxSign columns are untouched — we'll remove them after verification

**Please review the migration and run it when you're ready."**

---

## Step 8: Publish Templates

After the database migration is run, remind the developer to publish their templates in Anvil:

1. Open each template at `https://app.useanvil.com`
2. Review field tagging — verify aliases match the application's data model
3. Assign signature fields to the correct signer IDs
4. Click "Publish" to make the template available via API

Templates must be published before they can be used in `fillPDF` or `createEtchPacket` calls. Unpublished templates will return an error.
