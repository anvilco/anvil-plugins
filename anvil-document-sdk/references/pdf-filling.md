# PDF Filling Implementation Reference

## Overview

PDF Filling lets you fill a pre-tagged PDF template with structured JSON data and get back a completed PDF. The flow is simple: call `fillPDF` with a template ID and data, receive a PDF buffer.

## Prerequisites

- A PDF template uploaded and tagged in the Anvil dashboard
- The template's `castEid` (found on the template settings page in Anvil)
- Field aliases configured in the Anvil UI that map to the developer's data model

## Server-Side: Fill a PDF

```typescript
import Anvil from '@anvilco/anvil'
import { anvilClient } from './anvil-client' // your shared client module

interface FillPDFOptions {
  castEid: string
  data: Record<string, any>
  title?: string
  fontSize?: number
  textColor?: string
}

export async function fillPDF({ castEid, data, title, fontSize, textColor }: FillPDFOptions) {
  const payload: Record<string, any> = { data }
  if (title) payload.title = title
  if (fontSize) payload.fontSize = fontSize
  if (textColor) payload.textColor = textColor

  const { statusCode, data: pdfBuffer } = await anvilClient.fillPDF(castEid, payload)

  if (statusCode !== 200) {
    throw new Error(`Anvil PDF fill failed with status ${statusCode}`)
  }

  return pdfBuffer // Buffer containing the filled PDF
}
```

## Route Handler Pattern

The typical integration point is an API route that the frontend calls when the user clicks a button (e.g., "Generate W-4", "Download Invoice").

```typescript
// Example: Express route handler
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { templateId, formData } = req.body

    // Look up the castEid from your database using the templateId
    const template = await db.anvilTemplates.findOne({ id: templateId })

    const pdfBuffer = await fillPDF({
      castEid: template.castEid,
      data: formData,
    })

    // Option 1: Stream directly to the user
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${template.name}.pdf"`)
    res.send(pdfBuffer)

    // Option 2: Store as a BLOB in the database and return a reference
    // --- Developer: choose your storage approach ---
    // await db.generatedDocuments.create({
    //   templateId: template.id,
    //   userId: req.user.id,
    //   filename: `${template.name}.pdf`,
    //   contentType: 'application/pdf',
    //   fileData: pdfBuffer,       // BYTEA column
    //   sizeBytes: pdfBuffer.length,
    //   metadata: { castEid: template.castEid, formData },
    // })
    // res.json({ documentId: doc.id })

    // Option 3: Upload to S3 / cloud blob store instead
    // const key = `generated-pdfs/${template.name}-${Date.now()}.pdf`
    // await s3Client.send(new PutObjectCommand({ Bucket: process.env.DOCUMENTS_BUCKET, Key: key, Body: pdfBuffer }))
    // res.json({ documentUrl: `https://${process.env.DOCUMENTS_BUCKET}.s3.amazonaws.com/${key}` })
  } catch (error) {
    console.error('PDF generation failed:', error)
    res.status(500).json({ error: 'Failed to generate PDF' })
  }
})
```

## Data Payload Structure

The `data` object maps field aliases (set in the Anvil template UI) to values:

```typescript
const data = {
  // Field aliases as keys, values matching the field type
  employeeName: 'Jane Smith',
  ssn: '123-45-6789',
  address: '123 Main St',
  filingStatus: 'single', // for radio/checkbox groups
  signatureDate: '2025-01-15',
}
```

Field aliases are set when you tag the PDF in the Anvil dashboard. They should match the developer's data model so the mapping is straightforward.

## Using Draft Templates

To fill a draft (unpublished) version of a template during development:

```typescript
const { statusCode, data: pdfBuffer } = await anvilClient.fillPDF(
  castEid,
  payload,
  { versionNumber: Anvil.VERSION_LATEST }
)
```

## Database Schema Suggestion

```sql
-- Template definitions — one row per Anvil PDF template
CREATE TABLE anvil_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  cast_eid VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  field_mapping JSONB, -- maps internal field names to Anvil field aliases if they differ
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Generated PDFs — each stored as a BLOB, linked to whatever entity triggered it
-- (PDF Filling produces standalone documents, not packets, so no parent grouping needed)
CREATE TABLE generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES anvil_templates(id),
  user_id UUID REFERENCES users(id),          -- or whatever entity triggered the fill
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) DEFAULT 'application/pdf',
  file_data BYTEA NOT NULL,                   -- the actual PDF contents
  size_bytes INTEGER,
  metadata JSONB,                             -- store the payload data, cast_eid, etc.
  created_at TIMESTAMP DEFAULT NOW()
);
```

For PDF Filling, each generated PDF is standalone — there's no parent packet. Store it as an individual BLOB row linked to the entity that triggered the fill (user, invoice, application, etc.).

## Key Points

- Call `fillPDF` on demand — it's fast, no need to pre-generate
- The response `data` is a raw PDF buffer — prefer storing it as a BLOB (`BYTEA`) in your application database, or stream it directly to the user. For cloud storage (S3, GCS, Azure Blob), store the buffer there and save the URL to your database. Always ask the developer where they want the generated PDF stored — don't assume any approach
- Field aliases in the Anvil template should match the developer's data model
- Use `Anvil.VERSION_LATEST` during development to test with draft templates
- The Anvil client handles rate limiting automatically
