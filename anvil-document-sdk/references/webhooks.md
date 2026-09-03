# Webhooks Implementation Reference

## Overview

Anvil's webhook system notifies your application when events occur — a signer completes signing, a workflow finishes, a PDF is generated. Rather than polling for status, you register a **Webhook Action** that tells Anvil: "when *this action* happens on *this object*, POST to *this URL*."

## Registering Webhook Actions

Use the `createWebhookAction` GraphQL mutation to register for events. This is the programmatic way to subscribe — more reliable than setting a URL in the dashboard because it can be done as part of your integration code.

```typescript
import { anvilClient } from './anvil-client'

const CREATE_WEBHOOK_ACTION = `
  mutation CreateWebhookAction(
    $action: String!
    $objectType: String!
    $objectEid: String!
    $url: String!
  ) {
    createWebhookAction(
      action: $action
      objectType: $objectType
      objectEid: $objectEid
      url: $url
    ) {
      eid
      action
      objectType
      objectEid
      url
    }
  }
`

interface WebhookRegistration {
  /** The event to listen for (e.g., 'signerComplete', 'etchPacketComplete', 'weldComplete') */
  action: string
  /** The type of object to monitor (e.g., 'EtchPacket', 'Weld', 'WeldData') */
  objectType: string
  /** The EID of the specific object to monitor */
  objectEid: string
  /** Your endpoint URL that Anvil will POST to */
  url: string
}

export async function registerWebhook(registration: WebhookRegistration) {
  const { data, errors } = await anvilClient.requestGraphQL({
    query: CREATE_WEBHOOK_ACTION,
    variables: registration,
  })

  if (errors?.length) {
    throw new Error(`Failed to register webhook: ${JSON.stringify(errors)}`)
  }

  return data?.data?.createWebhookAction
}
```

### Removing a Webhook Action

When a webhook is no longer needed (e.g., after a packet is fully processed), clean it up:

```typescript
const REMOVE_WEBHOOK_ACTION = `
  mutation RemoveWebhookAction($eid: String!) {
    removeWebhookAction(eid: $eid)
  }
`

export async function removeWebhook(webhookEid: string) {
  const { data, errors } = await anvilClient.requestGraphQL({
    query: REMOVE_WEBHOOK_ACTION,
    variables: { eid: webhookEid },
  })

  if (errors?.length) {
    throw new Error(`Failed to remove webhook: ${JSON.stringify(errors)}`)
  }

  return data?.data?.removeWebhookAction
}
```

## Available Actions

| Action | Description | Supported Object Types |
|--------|-------------|----------------------|
| `signerComplete` | A signer finished signing their documents | `EtchPacket` |
| `etchPacketComplete` | All signers have completed — the packet is fully signed | `EtchPacket` |
| `forgeComplete` | A single webform within a workflow was completed | `Weld`, `WeldData` |
| `weldComplete` | The entire workflow is finished (all forms + signing done) | `Weld`, `WeldData` |
| `*` | Subscribe to all actions on an object | Any supported type |

Use `*` as the action to receive all events for an object. You can also use `*` as the objectType to monitor all objects of a given action within your organization.

## Webhook Handler Pattern

When Anvil fires a webhook, it POSTs JSON to your URL with `action`, `data`, and `token` fields.

```typescript
import { anvilClient } from './anvil-client'

// Express route handler for incoming Anvil webhooks
app.post('/api/webhooks/anvil', async (req, res) => {
  const { action, data, token } = req.body

  // Respond immediately — process asynchronously if the work is slow
  res.sendStatus(200)

  try {
    switch (action) {
      case 'signerComplete':
        await onSignerComplete(data)
        break

      case 'etchPacketComplete':
        await onEtchPacketComplete(data)
        break

      case 'forgeComplete':
        await onForgeComplete(data)
        break

      case 'weldComplete':
        await onWeldComplete(data)
        break

      default:
        console.log(`Unhandled Anvil webhook action: ${action}`, data)
    }
  } catch (err) {
    console.error(`Error processing webhook ${action}:`, err)
  }
})
```

## Common Webhook Handlers

These are skeleton handlers for the most common actions. Ask the developer what business logic should go inside each one, then fill it in together.

### Signer Complete

```typescript
async function onSignerComplete(data: any) {
  const { signerEid, etchPacketEid, weldDataEid } = data

  // Update your database to track which signers have completed
  await db.signingEvents.create({
    signerEid,
    packetEid: etchPacketEid,
    action: 'signerComplete',
    completedAt: new Date(),
  })

  // --- Developer: add your logic here ---
  // Examples:
  //   - Send a confirmation email to the signer
  //   - Notify the next signer it's their turn
  //   - Update the order/application status in your system
}
```

### Etch Packet Complete — Download All Documents

When all signers have finished, download **all the signed documents AND the signing certificate**. The signing certificate is an audit trail PDF that Anvil generates — it records who signed, when, their IP addresses, and other verification details. Always download and store it alongside the signed documents for legal compliance.

**Ask the developer:** "Do you want to download all documents as a single zip file, or each file individually?" This determines which download approach to use:

- **Zip (all files at once):** Use `downloadDocuments(documentGroupEid)` — returns a zip buffer containing every signed PDF and the certificate. Simpler when you just need to archive or forward everything together.
- **Individual files (recommended for database storage):** Query the packet to get each document's `eid` and `type`, then download them one at a time. Better when you need to store each document as a separate BLOB, route documents separately, or distinguish signed documents from the certificate.

#### Option A: Download as zip

**Ask the developer:** "Where should signed documents be stored — S3, another cloud storage provider, your local filesystem, or somewhere else? And do you already have a database table where you want to track the downloaded documents, or do we need to create one?" Most production integrations use a cloud blob store like S3 rather than the local filesystem.

```typescript
async function onEtchPacketComplete(data: any) {
  const { etchPacketEid, documentGroupEid, name } = data

  // Download all signed documents as a single zip
  const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
    documentGroupEid
  )

  if (statusCode === 200 && zipBuffer) {
    // --- Developer: store documents in your preferred storage ---
    // Preferred: Store each PDF as a BLOB in the application database
    // For zip downloads, extract individual PDFs first, then store each one
    await db.etchPacketDocuments.create({
      etchPacketId: packet.id,    // FK to etch_packets row
      fileEid: null,              // zip doesn't have an individual file EID
      filename: `${name ?? etchPacketEid}.zip`,
      contentType: 'application/zip',
      fileData: zipBuffer,        // BYTEA column
      sizeBytes: zipBuffer.length,
    })

    // Alternative: Upload to S3 / cloud blob store instead
    // const key = `signed-documents/${etchPacketEid}/${name ?? etchPacketEid}.zip`
    // await s3Client.send(new PutObjectCommand({ Bucket: process.env.DOCUMENTS_BUCKET, Key: key, Body: zipBuffer }))

    console.log(`Signed documents stored for packet: ${etchPacketEid}`)
  }

  await db.etchPackets.update(
    { packetEid: etchPacketEid },
    { status: 'completed', completedAt: new Date() }
  )

  // --- Developer: add your logic here ---
}
```

#### Option B: Download individual files (recommended for database storage)

This approach downloads each file separately — including the signing certificate — and stores them as individual BLOBs with proper type classification. Every document is associated to its `etchPacketEid`.

```typescript
const QUERY_PACKET_DOCUMENTS = `
  query EtchPacket($eid: String!) {
    etchPacket(eid: $eid) {
      eid
      name
      documentGroup {
        eid
        files {
          eid
          name
          type
          downloadZipURL
        }
      }
    }
  }
`

async function onEtchPacketComplete(data: any) {
  const { etchPacketEid } = data

  // Fetch the packet to get ALL file details (signed docs + certificate)
  const { data: result } = await anvilClient.requestGraphQL({
    query: QUERY_PACKET_DOCUMENTS,
    variables: { eid: etchPacketEid },
  })

  const files = result?.data?.etchPacket?.documentGroup?.files ?? []

  // Download and store EVERY file — signed documents AND the signing certificate
  for (const file of files) {
    const { statusCode, data: pdfBuffer } = await anvilClient.downloadDocuments(
      file.eid
    )

    if (statusCode === 200 && pdfBuffer) {
      // Classify the document type
      const isCertificate = file.type === 'signingCertificate'
        || file.name?.toLowerCase().includes('certificate')

      await db.etchPacketDocuments.create({
        etchPacketId: packet.id,                // FK to etch_packets row
        packetEid: etchPacketEid,               // denormalized for easy querying
        fileEid: file.eid,                      // Anvil's individual file EID
        documentType: isCertificate ? 'signing_certificate' : 'signed_document',
        filename: `${file.name}.pdf`,
        contentType: 'application/pdf',
        fileData: pdfBuffer,                    // BYTEA column
        sizeBytes: pdfBuffer.length,
      })

      console.log(`Stored: ${file.name} (${isCertificate ? 'certificate' : 'signed document'})`)
    }
  }

  await db.etchPackets.update(
    { packetEid: etchPacketEid },
    { status: 'completed', completedAt: new Date() }
  )

  // --- Developer: add your logic here ---
  // Examples:
  //   - Route each document to a different system (NDA → legal, offer letter → HR)
  //   - Attach specific documents to different database records
  //   - Send individual documents to different recipients
  //   - Archive the signing certificate for compliance
}
```

### Workflow Complete — Download All Output Documents

When an entire workflow finishes (all webforms submitted, all documents signed), download **all output documents — filled PDFs, signed PDFs, AND the signing certificate** (if the workflow includes signing). Every downloaded document should be associated to its `weldDataEid`. The same zip vs. individual question applies here — ask the developer which approach they prefer. The zip option is shown below; for individual file downloads, use the same query pattern from the Etch example above (adapted for the workflow's document group), classifying each file as `'filled_document'`, `'signed_document'`, or `'signing_certificate'`.

```typescript
async function onWeldComplete(data: any) {
  const { weldEid, weldDataEid, documentGroupEid } = data

  // Download completed workflow documents as a zip
  if (documentGroupEid) {
    const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
      documentGroupEid
    )

    if (statusCode === 200 && zipBuffer) {
      // --- Developer: store documents as BLOBs in the database ---
      await db.workflowPacketDocuments.create({
        workflowPacketId: packet.id,  // FK to workflow_packets row
        fileEid: null,                // zip doesn't have an individual file EID
        filename: `${weldDataEid}.zip`,
        contentType: 'application/zip',
        fileData: zipBuffer,          // BYTEA column
        sizeBytes: zipBuffer.length,
      })

      // Alternative: Upload to S3 / cloud blob store instead
      // const key = `workflow-documents/${weldDataEid}/${weldDataEid}.zip`
      // await s3Client.send(new PutObjectCommand({ Bucket: process.env.DOCUMENTS_BUCKET, Key: key, Body: zipBuffer }))

      console.log(`Workflow documents stored for: ${weldDataEid}`)
    }
  }

  // Update workflow status
  await db.workflowSubmissions.update(
    { weldDataEid },
    { status: 'completed', completedAt: new Date() }
  )

  // --- Developer: add your logic here ---
  // Examples:
  //   - Mark the onboarding process as complete
  //   - Send a summary email with the documents attached
  //   - Archive the workflow data
}
```

### Forge (Webform) Complete

```typescript
async function onForgeComplete(data: any) {
  const { forgeEid, weldDataEid, submissionEid } = data

  // Update submission status
  await db.workflowSubmissions.update(
    { submissionEid },
    { status: 'step_completed', updatedAt: new Date() }
  )

  // --- Developer: add your logic here ---
  // Examples:
  //   - Pre-fill data for the next step based on what was submitted
  //   - Send a notification that a form was completed
  //   - Validate the submitted data before the workflow continues
}
```

## Registering Webhooks at Integration Time

When creating an Etch packet or starting a workflow, register webhooks for the events that matter to the developer. This should happen right after the object is created:

```typescript
// Example: after creating an Etch packet, register for completion events
const packet = await createEtchPacket({ /* ... */ })

await registerWebhook({
  action: 'etchPacketComplete',
  objectType: 'EtchPacket',
  objectEid: packet.eid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})

// Optionally also register for per-signer events
await registerWebhook({
  action: 'signerComplete',
  objectType: 'EtchPacket',
  objectEid: packet.eid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})
```

```typescript
// Example: after starting a workflow, register for completion events
const workflow = await startWorkflow({ /* ... */ })

await registerWebhook({
  action: 'weldComplete',
  objectType: 'WeldData',
  objectEid: workflow.weldDataEid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})
```

## Database Schema for Webhook Tracking

```sql
CREATE TABLE anvil_webhook_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_eid VARCHAR(255) NOT NULL,    -- Anvil's webhook action EID
  action VARCHAR(100) NOT NULL,          -- e.g., 'etchPacketComplete'
  object_type VARCHAR(100) NOT NULL,     -- e.g., 'EtchPacket'
  object_eid VARCHAR(255) NOT NULL,      -- EID of the monitored object
  url TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE anvil_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,
  object_eid VARCHAR(255),
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  received_at TIMESTAMP DEFAULT NOW()
);
```

## Key Points

- Register webhooks programmatically via `createWebhookAction` rather than only in the dashboard — this makes the integration self-contained and reproducible
- Always respond to Anvil with a 200 status immediately, then process the event asynchronously
- Use `downloadDocuments(documentGroupEid)` to fetch completed signed PDFs — the documentGroupEid comes in the webhook payload for `etchPacketComplete` and `weldComplete` events
- Clean up webhook actions with `removeWebhookAction` when they're no longer needed
- Ask the developer what should happen inside each handler — provide the skeleton, let them fill in the business logic (or prompt you to write it)
- Always ask where downloaded documents should be stored (S3, GCS, Azure Blob, local disk, etc.) and how to track them in the database — don't assume local filesystem
