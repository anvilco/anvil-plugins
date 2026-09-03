# Etch E-Sign Implementation Reference

## Overview

Etch E-Sign lets you create signature packets containing one or more PDFs and send them to one or more signers. Packets can be delivered via Anvil's email flow or embedded directly in your app using iframes.

## Prerequisites

- PDF template(s) uploaded and tagged in the Anvil dashboard with their `castEid`(s)
- Signer information (name, email at minimum)
- Decision on signing mode: **email-based** (Anvil sends emails) or **embedded** (signing UI in your app)
- If embedded: "Iframe Embedding" enabled and app domains whitelisted at `https://app.useanvil.com/org/<org-slug>/settings/api`

## Creating an Etch Packet

The `createEtchPacket` mutation is the primary API call. It creates and optionally sends a signature packet in a single call.

```typescript
import { anvilClient } from './anvil-client'

interface Signer {
  id: string
  name: string
  email: string
  signerType: 'email' | 'embedded'
  fields?: Array<{
    fileId: string
    fieldId: string
  }>
}

interface EtchPacketOptions {
  name: string
  signers: Signer[]
  files: Array<{
    id: string        // your internal identifier for this file in the packet
    castEid: string   // the Anvil template ID
    data?: {
      payloads: Record<string, Record<string, any>> // signerEid -> field data
    }
  }>
  isDraft?: boolean
  isTest?: boolean
  webhookURL?: string
}

export async function createEtchPacket(options: EtchPacketOptions) {
  const variables = {
    name: options.name,
    isDraft: options.isDraft ?? false,
    isTest: options.isTest ?? false,
    signers: options.signers,
    files: options.files,
    ...(options.webhookURL && { webhookURL: options.webhookURL }),
  }

  const { statusCode, data, errors } = await anvilClient.createEtchPacket({ variables })

  if (errors) {
    throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
  }

  return data?.data?.createEtchPacket
}
```

## Signer Configuration

Every signer **must** be connected to at least one signature field on a PDF in the packet. This is not optional — if a signer has no fields assigned, the packet creation will fail. The `fields` array maps each signer to the specific signature, date, and initial fields they are responsible for on each document.

The `fileId` must match the `id` you gave that file in the `files` array when creating the packet. The `fieldId` must match a field alias on the PDF template in Anvil. Ask the developer which fields on each template belong to which signer.

### Email-based signing (Anvil sends the emails)
```typescript
const signers = [
  {
    id: 'signer1',
    name: 'Jane Smith',
    email: 'jane@example.com',
    signerType: 'email',
    fields: [
      // Every signer needs at least one field — connect them to their
      // signature, date, and initial fields on each document
      { fileId: 'templateNDA', fieldId: 'signatureField1' },
      { fileId: 'templateNDA', fieldId: 'dateField1' },
    ],
  },
]
```

### Embedded signing (in your app)
```typescript
const signers = [
  {
    id: 'signer1',
    name: 'Jane Smith',
    email: 'jane@example.com',
    signerType: 'embedded', // won't receive an email — you handle the UI
    fields: [
      { fileId: 'templateNDA', fieldId: 'signatureField1' },
    ],
  },
]
```

For embedded signers, you are responsible for authenticating the user, generating a sign URL, and presenting the signing UI.

## Generating an Embedded Sign URL

When a signer is ready to sign, generate a short-lived URL and embed it:

```typescript
export async function getSignURL(signerEid: string, clientUserId: string) {
  const { data, errors } = await anvilClient.generateEtchSignURL({
    variables: {
      signerEid,
      clientUserId, // your internal user ID for audit trail
    },
  })

  if (errors) {
    throw new Error(`Failed to generate sign URL: ${JSON.stringify(errors)}`)
  }

  return data?.data?.generateEtchSignURL
}
```

The returned URL contains a token valid for 2 hours by default (configurable via `tokenValidForMinutes`). Best practice: generate it right when the user is about to sign, not in advance.

## Route Handler Pattern

```typescript
// Create a packet when user clicks "Sign Documents"
app.post('/api/etch/create-packet', async (req, res) => {
  try {
    const { userId, documentIds, signerDetails } = req.body

    // Look up castEids from your database
    const templates = await db.anvilTemplates.findByIds(documentIds)

    const packet = await createEtchPacket({
      name: `Signing packet for user ${userId}`,
      isTest: process.env.NODE_ENV !== 'production',
      signers: signerDetails,
      files: templates.map((t) => ({
        id: t.internalId,
        castEid: t.castEid,
      })),
      webhookURL: `${process.env.APP_URL}/api/webhooks/anvil`,
    })

    // Store the packet EID in your database
    await db.etchPackets.create({
      userId,
      packetEid: packet.eid,
      status: 'sent',
    })

    res.json({ packetEid: packet.eid })
  } catch (error) {
    console.error('Etch packet creation failed:', error)
    res.status(500).json({ error: 'Failed to create signing packet' })
  }
})

// Generate sign URL for embedded signing
app.post('/api/etch/sign-url', async (req, res) => {
  try {
    const { signerEid } = req.body
    const userId = req.user.id // from your auth middleware

    const signURL = await getSignURL(signerEid, userId)
    res.json({ signURL })
  } catch (error) {
    console.error('Failed to generate sign URL:', error)
    res.status(500).json({ error: 'Failed to generate signing URL' })
  }
})
```

## React Embedded Signing Component

When the frontend is React, use the official `AnvilEmbedFrame` component:

```tsx
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

interface SigningViewProps {
  signURL: string
  onFinish: (payload: { action: string; signerEid: string }) => void
}

function SigningView({ signURL, onFinish }: SigningViewProps) {
  const handleEvent = (event: { action: string; [key: string]: any }) => {
    switch (event.action) {
      case 'signerComplete':
        onFinish(event)
        break
      case 'signerError':
        console.error('Signing error:', event)
        break
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '800px' }}>
      <AnvilEmbedFrame
        iframeURL={signURL}
        onEvent={handleEvent}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
```

The wrapper div with `minHeight` is important — `AnvilEmbedFrame` renders an iframe that sizes to its container. Without explicit dimensions on the parent element, the iframe may collapse to zero height and be invisible. Always ensure the parent has a defined width and height (100% of a sized ancestor, or an explicit pixel/vh value).

For non-React frontends, embed the sign URL in an iframe manually and listen for `postMessage` events from the Anvil iframe.

## Interactive Fields

If a document has fields the signer needs to fill in (not just sign), those fields must be explicitly assigned to a signer. This is a common gotcha — unassigned interactive fields won't appear for any signer.

```typescript
const signers = [
  {
    id: 'signer1',
    name: 'Employee',
    email: 'employee@example.com',
    signerType: 'embedded',
    fields: [
      // Signature fields
      { fileId: 'w4Form', fieldId: 'employeeSignature' },
      // Interactive fields (signer fills these in)
      { fileId: 'w4Form', fieldId: 'filingStatus' },
      { fileId: 'w4Form', fieldId: 'dependents' },
    ],
  },
]
```

Before creating the packet, confirm with the developer which fields are interactive and which signer should fill them in.

## Webhook Registration and Handling

After creating a packet, register for the events the developer cares about using `createWebhookAction`. See `references/webhooks.md` for the full `registerWebhook` helper function.

```typescript
import { registerWebhook } from './anvil-webhooks' // from webhooks reference

// Register immediately after creating the packet
const packet = await createEtchPacket({ /* ... */ })

// Register for packet-level completion
await registerWebhook({
  action: 'etchPacketComplete',
  objectType: 'EtchPacket',
  objectEid: packet.eid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})

// Optionally register for per-signer progress
await registerWebhook({
  action: 'signerComplete',
  objectType: 'EtchPacket',
  objectEid: packet.eid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})
```

The handler receives events and dispatches them. Respond with 200 immediately, then process:

```typescript
app.post('/api/webhooks/anvil', async (req, res) => {
  const { action, data, token } = req.body
  res.sendStatus(200)

  switch (action) {
    case 'signerComplete':
      // A signer finished signing
      // --- Developer: add your logic here ---
      break

    case 'etchPacketComplete':
      // All signers completed — download the signed documents
      const { documentGroupEid } = data
      const { data: zipBuffer } = await anvilClient.downloadDocuments(documentGroupEid)
      // --- Developer: store the document in your preferred storage (S3, GCS, Azure Blob, etc.) ---
      // See references/webhooks.md for full storage patterns with S3 example
      // --- Developer: track the document in your database ---
      break

    default:
      console.log(`Unhandled Anvil webhook action: ${action}`)
  }
})
```

Ask the developer what business logic should run inside each handler. Common actions: downloading completed PDFs (shown above), updating order/application status, sending confirmation emails, triggering downstream processes. See `references/webhooks.md` for full handler examples with `downloadDocuments`.

## Database Schema Suggestion

Use a two-table pattern: a packet table that groups the documents, and a documents table that stores each individual PDF as a BLOB.

```sql
-- The packet (container) — one row per signing request
CREATE TABLE etch_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),
  packet_eid VARCHAR(255) NOT NULL,          -- Anvil's etchPacketEid
  document_group_eid VARCHAR(255),           -- Anvil's documentGroupEid (populated on completion)
  type VARCHAR(100),                         -- e.g., 'nda_signing', 'offer_letter', 'vendor_agreement'
  status VARCHAR(50) DEFAULT 'created',      -- created, sent, partial, completed
  metadata JSONB,                            -- signer EIDs, document details, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual documents — each stored as a BLOB, linked to its parent packet
-- This includes BOTH signed PDFs AND the signing certificate
CREATE TABLE etch_packet_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etch_packet_id UUID REFERENCES etch_packets(id) ON DELETE CASCADE,
  packet_eid VARCHAR(255) NOT NULL,          -- Anvil's etchPacketEid (denormalized for easy querying)
  file_eid VARCHAR(255),                     -- Anvil's individual file EID
  document_type VARCHAR(50) NOT NULL,        -- 'signed_document' or 'signing_certificate'
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) DEFAULT 'application/pdf',
  file_data BYTEA NOT NULL,                  -- the actual PDF contents
  size_bytes INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Each completed Etch packet contains **all the signed PDFs plus a signing certificate**. The signing certificate is an audit trail PDF that records who signed, when, their IP address, and other signature metadata. **Always download and store both the signed documents and the certificate** — the certificate is important for legal compliance and audit purposes. The `document_type` column distinguishes signed documents from the certificate. All rows are associated to the parent `etch_packets` row via `etch_packet_id`, and also store the `packet_eid` directly for easy querying without joins.

## Downloading Completed Documents

A completed Etch packet contains **all the signed PDFs plus a signing certificate**. The signing certificate is an audit trail PDF generated by Anvil that records who signed, when, their IP addresses, and other signature verification details. **Always download and store all files — both the signed documents and the certificate.** The certificate is critical for legal compliance.

Completed documents can be downloaded in two ways — automatically via a webhook handler, or on demand via an API request (e.g., a "Download Documents" button in the UI). Ask the developer: **"Should completed documents be downloaded automatically when signing finishes (via webhook), or on demand when a user clicks a button — or both?"**

Also ask: **"Do you want all files as a single zip, or each file individually?"** Zip is simpler for archiving. Individual downloads are better when documents need to be routed separately.

Also ask: **"Where should signed documents be stored — S3, another cloud storage provider, your local filesystem, or somewhere else?"** Most production integrations save documents to a blob store (S3, Google Cloud Storage, Azure Blob) rather than local disk. Also ask whether they have an existing database table to associate the downloaded PDF with, or whether a new one is needed. If the developer doesn't specify, always ask — don't assume local filesystem storage.

### On-demand download route

```typescript
// Download all signed documents for a packet as a zip
app.get('/api/etch/:packetEid/documents', async (req, res) => {
  try {
    const { packetEid } = req.params

    // Look up the documentGroupEid from your database
    const packet = await db.etchPackets.findOne({ packetEid })
    if (!packet?.documentGroupEid) {
      return res.status(404).json({ error: 'Packet not found or not yet completed' })
    }

    const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
      packet.documentGroupEid
    )

    if (statusCode === 200 && zipBuffer) {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${packetEid}-signed.zip"`)
      res.send(zipBuffer)
    } else {
      res.status(502).json({ error: 'Failed to download documents from Anvil' })
    }
  } catch (error) {
    console.error('Document download failed:', error)
    res.status(500).json({ error: 'Failed to download documents' })
  }
})

// Download a single document from a packet
app.get('/api/etch/:packetEid/documents/:fileEid', async (req, res) => {
  try {
    const { packetEid, fileEid } = req.params

    const { statusCode, data: fileBuffer } = await anvilClient.downloadDocuments(fileEid)

    if (statusCode === 200 && fileBuffer) {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${fileEid}.zip"`)
      res.send(fileBuffer)
    } else {
      res.status(502).json({ error: 'Failed to download document from Anvil' })
    }
  } catch (error) {
    console.error('Document download failed:', error)
    res.status(500).json({ error: 'Failed to download document' })
  }
})
```

For webhook-triggered downloads, see `references/webhooks.md` — the `onEtchPacketComplete` handler shows both the zip and individual file patterns.

## Which PDFs to Present to Users

When the developer is building a UI to display or download completed documents, they may be unsure which PDFs to show to the end user. Guide them with this recommendation:

- **Default recommendation: Show the signed document(s).** These are the final, signed versions of each PDF in the packet — this is what users expect to see and download.
- **Also offer the signing certificate as an option.** Some users (especially legal, compliance, or HR teams) want the certificate for their records. Present it as a secondary download option (e.g., a "Download Certificate" link alongside the signed documents).
- **In some cases, the output is a single merged PDF** — Anvil can merge all documents in a packet into one combined PDF. When this happens, there will only be one signed document to present (plus the certificate). The code should handle both cases: multiple individual files or a single merged file.

Ask the developer: **"When the user views their completed documents, should we show just the signed PDFs, the signing certificate too, or both? And is your Anvil configuration set to merge documents into a single PDF, or keep them separate?"**

## Key Points

- Create packets on demand when the user is ready to sign — don't pre-create
- For embedded signing: set `signerType: 'embedded'`, then use `generateEtchSignURL` to get the iframe URL
- Sign URLs expire in 2 hours — generate them at the moment of signing
- Interactive fields must be assigned to a signer or they won't appear
- Use `isTest: true` during development — test packets don't count against your plan
- Always set up a webhook URL to track signing progress
