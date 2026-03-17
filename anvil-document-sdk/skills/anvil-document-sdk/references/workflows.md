# Workflows Implementation Reference

## Overview

Workflows combine multi-step webforms, PDF filling, and e-signatures into a single configurable pipeline. The `forgeSubmit` mutation is the central API call — it starts new workflows, submits data to existing steps, and moves the workflow forward.

## Prerequisites

- A Workflow configured in the Anvil dashboard (with webforms, PDF templates, and/or signature steps)
- The `forgeEid` for the webform (Forge) you want to submit to — found in the Anvil dashboard
- Decision on hosting: **Anvil-hosted** (redirect to Anvil's pages) or **embedded** (iframe in your app)
- If embedded: "Iframe Embedding" enabled and app domains whitelisted at `https://app.useanvil.com/org/<org-slug>/settings/api`

## Core Concept: forgeSubmit

The `forgeSubmit` mutation handles two scenarios:
1. **Starting a new workflow** — provide only `forgeEid` and `payload`. Anvil creates a new `WeldData` and `Submission`.
2. **Updating an existing submission** — also provide `weldDataEid` and/or `submissionEid` to update data in an existing workflow run.

## Starting a Workflow

```typescript
import { anvilClient } from './anvil-client'

interface StartWorkflowOptions {
  forgeEid: string
  payload: Record<string, any>
  isTest?: boolean
  webhookURL?: string
}

export async function startWorkflow(options: StartWorkflowOptions) {
  const result = await anvilClient.forgeSubmit({
    variables: {
      forgeEid: options.forgeEid,
      payload: options.payload,
      complete: false,  // false = keep the workflow open for more steps
      isTest: options.isTest ?? false,
      ...(options.webhookURL && { webhookURL: options.webhookURL }),
    },
  })

  const submission = result.data?.data?.forgeSubmit

  if (!submission) {
    throw new Error(`forgeSubmit failed: ${JSON.stringify(result.data?.errors)}`)
  }

  return {
    submissionEid: submission.eid,
    weldDataEid: submission.weldData.eid,
    continueURL: submission.weldData.continueURL, // URL for the webform
    forgeEid: submission.forge.eid,
    forgeSlug: submission.forge.slug,
  }
}
```

## Updating an Existing Submission

```typescript
interface UpdateSubmissionOptions {
  forgeEid: string
  weldDataEid: string
  submissionEid: string
  payload: Record<string, any>
  complete?: boolean  // true = mark this step as done and advance
  webhookURL?: string
}

export async function updateSubmission(options: UpdateSubmissionOptions) {
  const result = await anvilClient.forgeSubmit({
    variables: {
      forgeEid: options.forgeEid,
      weldDataEid: options.weldDataEid,
      submissionEid: options.submissionEid,
      payload: options.payload,
      complete: options.complete ?? false,
      ...(options.webhookURL && { webhookURL: options.webhookURL }),
    },
  })

  return result.data?.data?.forgeSubmit
}
```

## Route Handler Pattern

```typescript
// Start a new workflow when user clicks "Begin Onboarding" (or similar)
app.post('/api/workflows/start', async (req, res) => {
  try {
    const { workflowType, initialData } = req.body
    const userId = req.user.id

    // Look up the forgeEid from your database
    const workflow = await db.anvilWorkflows.findOne({ type: workflowType })

    const result = await startWorkflow({
      forgeEid: workflow.forgeEid,
      payload: initialData,
      isTest: process.env.NODE_ENV !== 'production',
      webhookURL: `${process.env.APP_URL}/api/webhooks/anvil`,
    })

    // Store the workflow state in your database
    await db.workflowSubmissions.create({
      userId,
      workflowType,
      submissionEid: result.submissionEid,
      weldDataEid: result.weldDataEid,
      continueURL: result.continueURL,
      status: 'in_progress',
    })

    res.json({
      submissionEid: result.submissionEid,
      continueURL: result.continueURL,
    })
  } catch (error) {
    console.error('Failed to start workflow:', error)
    res.status(500).json({ error: 'Failed to start workflow' })
  }
})

// Update / submit data to an existing workflow step
app.post('/api/workflows/submit', async (req, res) => {
  try {
    const { submissionEid, weldDataEid, forgeEid, payload, complete } = req.body

    const result = await updateSubmission({
      forgeEid,
      weldDataEid,
      submissionEid,
      payload,
      complete,
    })

    // Update status in your database
    if (complete) {
      await db.workflowSubmissions.update(
        { submissionEid },
        { status: 'step_completed' }
      )
    }

    res.json(result)
  } catch (error) {
    console.error('Failed to submit workflow data:', error)
    res.status(500).json({ error: 'Failed to submit workflow data' })
  }
})
```

## Pre-Filling Webform Data

You can pre-fill webform fields by passing data in the `payload` when calling `forgeSubmit`. The keys in the payload should match the field aliases configured in the Anvil webform editor.

```typescript
const result = await startWorkflow({
  forgeEid: 'your-forge-eid',
  payload: {
    // Keys match the webform field aliases
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@example.com',
    department: 'Engineering',
  },
})
```

Alternatively, you can pre-fill via URL query parameter when redirecting:
```typescript
const prefillData = encodeURIComponent(JSON.stringify({
  firstName: 'Jane',
  lastName: 'Smith',
}))
const webformURL = `${continueURL}?d=${prefillData}`
```

## React Embedded Workflow Component

```tsx
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

interface WorkflowEmbedProps {
  continueURL: string
  onPageSubmit: (event: any) => void
  onWorkflowComplete: (event: any) => void
}

function WorkflowEmbed({ continueURL, onPageSubmit, onWorkflowComplete }: WorkflowEmbedProps) {
  const handleEvent = (event: { action: string; [key: string]: any }) => {
    switch (event.action) {
      case 'forgeSubmitPage':
        // A single page/step was submitted
        onPageSubmit(event)
        break
      case 'forgeComplete':
        // The entire forge (webform) is complete
        onWorkflowComplete(event)
        break
      case 'weldComplete':
        // The entire workflow (all forges) is complete
        onWorkflowComplete(event)
        break
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '800px' }}>
      <AnvilEmbedFrame
        iframeURL={continueURL}
        onEvent={handleEvent}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
```

The wrapper div with `minHeight` is important — `AnvilEmbedFrame` renders an iframe that sizes to its container. Without explicit dimensions on the parent, the iframe may collapse to zero height and be invisible. Always ensure the parent has a defined width and height.

For non-React frontends, embed the `continueURL` in an iframe and listen for `postMessage` events. Apply the same sizing rule — give the iframe explicit `width: 100%; height: 100%` and ensure its parent container has a defined height.

## Webhook Registration and Handling

After starting a workflow, register for the events the developer cares about using `createWebhookAction`. See `references/webhooks.md` for the full `registerWebhook` helper function.

```typescript
import { registerWebhook } from './anvil-webhooks' // from webhooks reference

// Register immediately after starting the workflow
const workflow = await startWorkflow({ /* ... */ })

// Register for workflow completion (all steps + signing done)
await registerWebhook({
  action: 'weldComplete',
  objectType: 'WeldData',
  objectEid: workflow.weldDataEid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})

// Optionally register for per-step completion
await registerWebhook({
  action: 'forgeComplete',
  objectType: 'WeldData',
  objectEid: workflow.weldDataEid,
  url: `${process.env.APP_URL}/api/webhooks/anvil`,
})
```

The handler receives events and dispatches them. Respond with 200 immediately, then process:

```typescript
app.post('/api/webhooks/anvil', async (req, res) => {
  const { action, data, token } = req.body
  res.sendStatus(200)

  switch (action) {
    case 'forgeComplete':
      // A webform step was completed
      // --- Developer: add your logic here ---
      break

    case 'weldComplete':
      // Entire workflow finished — download the output documents
      const { documentGroupEid, weldDataEid } = data
      if (documentGroupEid) {
        const { data: zipBuffer } = await anvilClient.downloadDocuments(documentGroupEid)
        // --- Developer: store the document in your preferred storage (S3, GCS, Azure Blob, etc.) ---
        // See references/webhooks.md for full storage patterns with S3 example
        // --- Developer: track the document in your database ---
      }
      // --- Developer: add your logic here ---
      break

    case 'signerComplete':
      // A signer completed (if the workflow includes signing)
      // --- Developer: add your logic here ---
      break

    default:
      console.log(`Unhandled Anvil webhook action: ${action}`)
  }
})
```

Ask the developer what business logic should execute inside each handler. Common actions: downloading completed documents (shown above), updating status, sending notifications. See `references/webhooks.md` for full handler examples.

## Database Schema Suggestion

Use a three-table pattern: a workflow definition table, a packet table for each submission, and a documents table that stores each individual PDF as a BLOB.

```sql
-- Workflow definitions — one row per configured workflow type
CREATE TABLE anvil_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  type VARCHAR(100) NOT NULL,                -- e.g., 'employee_onboarding', 'vendor_agreement'
  forge_eid VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow packets (submissions) — one row per workflow run
CREATE TABLE workflow_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  workflow_id UUID REFERENCES anvil_workflows(id),
  submission_eid VARCHAR(255),
  weld_data_eid VARCHAR(255),                -- Anvil's weldDataEid
  document_group_eid VARCHAR(255),           -- Anvil's documentGroupEid (populated on completion)
  type VARCHAR(100),                         -- e.g., 'employee_onboarding', 'vendor_agreement'
  continue_url TEXT,
  status VARCHAR(50) DEFAULT 'started',      -- started, in_progress, step_completed, completed
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual documents — each stored as a BLOB, linked to its parent packet
-- This includes filled PDFs, signed PDFs, AND the signing certificate (if the workflow includes signing)
CREATE TABLE workflow_packet_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_packet_id UUID REFERENCES workflow_packets(id) ON DELETE CASCADE,
  weld_data_eid VARCHAR(255) NOT NULL,       -- Anvil's weldDataEid (denormalized for easy querying)
  file_eid VARCHAR(255),                     -- Anvil's individual file EID
  document_type VARCHAR(50) NOT NULL,        -- 'filled_document', 'signed_document', or 'signing_certificate'
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) DEFAULT 'application/pdf',
  file_data BYTEA NOT NULL,                  -- the actual PDF contents
  size_bytes INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Each completed workflow produces **all output PDFs (filled and/or signed) plus a signing certificate** (if the workflow includes a signing step). **Always download and store all files — including the certificate.** The `document_type` column distinguishes between filled documents, signed documents, and the signing certificate. All rows are associated to the parent `workflow_packets` row via `workflow_packet_id`, and also store the `weld_data_eid` directly for easy querying without joins.

## Downloading Completed Documents

A completed workflow produces **all output PDFs plus a signing certificate** (if the workflow includes signing). The output may include filled PDFs, signed PDFs, or both — depending on how the workflow is configured. **Always download and store all files — including the certificate.** Every downloaded document should be associated to its `weldDataEid`.

Like Etch, completed workflow documents can be downloaded automatically via a webhook or on demand via an API route. Ask the developer which approach they need (or both).

Also ask: **"Where should completed workflow documents be stored — S3, another cloud storage provider, your local filesystem, or somewhere else?"** Most production integrations save documents to a blob store rather than local disk. Also ask whether they have an existing database table to associate the documents with, or whether a new one is needed. If the developer doesn't specify, always ask — don't assume local filesystem storage.

### On-demand download route

```typescript
// Download all completed workflow documents as a zip
app.get('/api/workflows/:weldDataEid/documents', async (req, res) => {
  try {
    const { weldDataEid } = req.params

    // Look up the documentGroupEid from your database
    const submission = await db.workflowSubmissions.findOne({ weldDataEid })
    if (!submission?.documentGroupEid) {
      return res.status(404).json({ error: 'Workflow not found or not yet completed' })
    }

    const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
      submission.documentGroupEid
    )

    if (statusCode === 200 && zipBuffer) {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${weldDataEid}-documents.zip"`)
      res.send(zipBuffer)
    } else {
      res.status(502).json({ error: 'Failed to download documents from Anvil' })
    }
  } catch (error) {
    console.error('Document download failed:', error)
    res.status(500).json({ error: 'Failed to download documents' })
  }
})
```

For webhook-triggered downloads, see `references/webhooks.md` — the `onWeldComplete` handler shows the pattern. To store the `documentGroupEid` for on-demand use, capture it from the `weldComplete` webhook payload and save it to your database.

## Which PDFs to Present to Users

When the developer is building a UI to display completed workflow documents, guide them with this recommendation:

- **Default recommendation: Show the signed/filled document(s).** These are the final output documents — this is what users expect to see and download.
- **Also offer the signing certificate as an option** (if the workflow includes signing). Present it as a secondary download option for users who need the audit trail.
- **In some cases, the output is a single merged PDF** — Anvil can merge all workflow output documents into one combined PDF. When this happens, there will only be one document to present (plus the certificate, if signing was involved). The code should handle both cases.

Ask the developer: **"When the user views their completed workflow documents, should we show just the output PDFs, the signing certificate too, or both? And is your workflow configured to merge documents into a single PDF, or keep them separate?"**

## Key Points

- Always use `forgeSubmit` for creating and updating workflow submissions
- Store `weldDataEid` and `submissionEid` in your database — you need them for updates
- The `continueURL` is what you embed in an iframe or redirect to
- Set `complete: false` to keep the workflow open for more data; `complete: true` to advance
- Use `isTest: true` during development
- Set up webhooks and/or iframe event listeners — ask the developer what should happen at each stage
