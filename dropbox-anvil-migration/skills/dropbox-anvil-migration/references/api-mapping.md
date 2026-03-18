# DropboxSign → Anvil API Mapping Reference

This document provides a complete mapping between DropboxSign (formerly HelloSign) APIs and their Anvil Etch E-Sign equivalents. Use this as a reference when rewriting integration code.

---

## SDK / Package Mapping

| DropboxSign | Anvil |
|------------|-------|
| `hellosign-sdk` | `@anvilco/anvil` |
| `@dropbox/sign` | `@anvilco/anvil` |
| `@hellosign/openapi-javascript-sdk` | `@anvilco/anvil` |
| `HelloSign.client` (embedded UI) | `@anvilco/anvil-embed-frame` |

---

## Client Initialization

### Before (DropboxSign)

```typescript
// Old SDK (hellosign-sdk)
import HelloSign from 'hellosign-sdk'
const client = new HelloSign({ key: process.env.HELLOSIGN_API_KEY })

// New SDK (@dropbox/sign)
import * as DropboxSign from '@dropbox/sign'
const signatureRequestApi = new DropboxSign.SignatureRequestApi()
signatureRequestApi.username = process.env.DROPBOX_SIGN_API_KEY
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

Anvil uses a single client instance for all operations. No separate API classes needed.

---

## Signature Request Creation

### Before (DropboxSign — send with template)

```typescript
// hellosign-sdk
const response = await client.signatureRequest.sendWithTemplate({
  template_ids: ['tmpl_abc123'],
  title: 'NDA for Acme Corp',
  subject: 'Please sign this NDA',
  message: 'Hi, please review and sign the attached NDA.',
  signers: [
    {
      role: 'Client',
      email_address: 'jane@example.com',
      name: 'Jane Smith',
    },
  ],
  custom_fields: [
    { name: 'company_name', value: 'Acme Corp' },
    { name: 'effective_date', value: '2026-01-15' },
  ],
  test_mode: true,
})
const signatureRequestId = response.signature_request.signature_request_id
```

```typescript
// @dropbox/sign
const data = new DropboxSign.SignatureRequestSendWithTemplateRequest()
data.templateIds = ['tmpl_abc123']
data.title = 'NDA for Acme Corp'
data.subject = 'Please sign this NDA'
data.message = 'Hi, please review and sign the attached NDA.'
data.signers = [
  {
    role: 'Client',
    emailAddress: 'jane@example.com',
    name: 'Jane Smith',
  },
]
data.customFields = [
  { name: 'company_name', value: 'Acme Corp' },
  { name: 'effective_date', value: '2026-01-15' },
]
data.testMode = true
const response = await signatureRequestApi.signatureRequestSendWithTemplate(data)
const signatureRequestId = response.body.signatureRequest.signatureRequestId
```

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',
    isDraft: false,
    isTest: true,
    signatureEmailSubject: 'Please sign this NDA',        // customizes email subject
    signatureEmailBody: 'Hi, please review and sign the attached NDA.', // customizes email body
    signers: [
      {
        id: 'signer1',
        name: 'Jane Smith',
        email: 'jane@example.com',
        signerType: 'email',
        fields: [
          {
            fileId: 'ndaDoc',
            fieldId: 'signatureField', // field alias from template
          },
        ],
      },
    ],
    files: [
      {
        id: 'ndaDoc',
        castEid: 'xyz789...', // mapped from old template_id
      },
    ],
    data: {
      payloads: {
        ndaDoc: {
          data: {
            companyName: 'Acme Corp',        // field alias
            effectiveDate: '2026-01-15',      // field alias
          },
        },
      },
    },
  },
})

if (errors) {
  throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
}

const etchPacketEid = data?.data?.createEtchPacket?.eid
```

### Field Mapping

| DropboxSign Field | Anvil Equivalent | Notes |
|-------------------|-----------------|-------|
| `title` | `name` | Packet display name |
| `subject` | `signatureEmailSubject` | Customizes the email subject shown to signers (defaults to packet name) |
| `message` | `signatureEmailBody` | Customizes the email body shown to signers (placed alongside signing instructions, does not replace them) |
| `template_ids` | `files[].castEid` | Each template is a file entry with its castEid |
| `signers[].role` | `signers[].id` | Arbitrary string ID, used to link signer to fields |
| `signers[].email_address` | `signers[].email` | |
| `signers[].name` | `signers[].name` | |
| `signers[].order` | `signers[].routingOrder` | Integer for signing order |
| `custom_fields` | `data.payloads.{fileId}.data` | Key-value pairs using field aliases |
| `test_mode` | `isTest` | Watermarks documents, doesn't count against plan |
| `signing_redirect_url` | N/A (use `AnvilEmbedFrame` `onEvent`) | Handle redirect in your app's event handler |
| N/A | `replyToName` | Customizes the reply-to name on signing emails (defaults to org name) |
| N/A | `replyToEmail` | Customizes the reply-to email on signing emails (defaults to org support email) |
| `metadata` | Store in your own DB | Anvil doesn't have a metadata bag on packets |
| `allow_decline` | N/A (app-level flow) | See feature-parity.md |
| `expires_at` | Sign URL TTL | See feature-parity.md |

---

## Embedded Signing

### Before (DropboxSign)

```typescript
// Server: get embedded sign URL
const response = await client.embedded.getSignUrl(signatureId)
const signUrl = response.embedded.sign_url

// Client: open signing UI
import HelloSign from 'hellosign-embedded'
const hsClient = new HelloSign({ clientId: process.env.HELLOSIGN_CLIENT_ID })

hsClient.open(signUrl, {
  skipDomainVerification: true, // dev only
})

hsClient.on('sign', () => {
  console.log('Document signed!')
})

hsClient.on('close', () => {
  console.log('Signing modal closed')
})
```

### After (Anvil)

```typescript
// Server: generate sign URL
const { url } = await anvilClient.generateEtchSignURL({
  variables: {
    signerEid: signerEid,       // from createEtchPacket response
    clientUserId: 'user-123',   // your app's user ID
  },
})

// Client: open signing UI (React)
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

function SigningPage({ signURL }: { signURL: string }) {
  return (
    <AnvilEmbedFrame
      iframeURL={signURL}
      onEvent={(event) => {
        if (event.action === 'signerComplete') {
          console.log('Document signed!')
          // Redirect or update UI
        }
        if (event.action === 'signerError') {
          console.error('Signing error:', event)
        }
      }}
    />
  )
}
```

**Important:** Before using embedded signing, enable iframe embedding and whitelist your domains in the Anvil dashboard at `https://app.useanvil.com/org/<org-slug>/settings/api`.

### Embedded Signing Event Mapping

| DropboxSign Event | Anvil Event (`onEvent` action) |
|-------------------|-------------------------------|
| `sign` | `signerComplete` |
| `close` | `signerComplete` or user navigates away |
| `cancel` | N/A (see feature-parity.md for decline flow) |
| `error` | `signerError` |
| `finish` | `signerComplete` |

---

## Webhook Event Mapping

| DropboxSign Event | Anvil Event | Notes |
|-------------------|------------|-------|
| `signature_request_sent` | `etchPacketComplete` (with status check) | Anvil fires events per packet lifecycle |
| `signature_request_viewed` | N/A | Not available as a webhook event |
| `signature_request_signed` | `signerComplete` | Fires per signer |
| `signature_request_all_signed_and_complete` | `etchPacketComplete` | Fires when all signers have signed |
| `signature_request_downloadable` | `etchPacketComplete` | Documents are downloadable when packet completes |
| `signature_request_declined` | N/A (app-level) | See feature-parity.md |
| `signature_request_expired` | N/A | See feature-parity.md |
| `signature_request_remind` | N/A | Anvil allows application to trigger new reminder emails |
| `template_created` | N/A | Template lifecycle managed in dashboard |
| `template_error` | N/A | |

### Before (DropboxSign webhook handler)

```typescript
import { EventCallbackHelper } from '@dropbox/sign'

app.post('/webhooks/hellosign', (req, res) => {
  const event = req.body

  // Verify webhook signature
  if (!EventCallbackHelper.isValid(process.env.HELLOSIGN_API_KEY, event)) {
    return res.status(401).send('Invalid signature')
  }

  const eventType = event.event.event_type
  const signatureRequestId = event.signature_request?.signature_request_id

  switch (eventType) {
    case 'signature_request_signed':
      // A signer completed signing
      await handleSignerComplete(signatureRequestId, event)
      break

    case 'signature_request_all_signed_and_complete':
      // All signers done — download documents
      await downloadAndStoreDocuments(signatureRequestId)
      break

    case 'signature_request_declined':
      await handleDecline(signatureRequestId, event)
      break
  }

  res.json({ status: 'ok' })
})
```

### After (Anvil webhook handler)

```typescript
app.post('/webhooks/anvil', async (req, res) => {
  const event = req.body

  // Anvil webhook verification uses the webhook action's secret
  // or you can verify the payload structure

  const { action, data } = event

  switch (action) {
    case 'signerComplete': {
      // A signer completed signing
      const { signerEid, etchPacketEid } = data
      await handleSignerComplete(etchPacketEid, data)
      break
    }

    case 'etchPacketComplete': {
      // All signers done — download documents
      const { etchPacketEid } = data
      const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
        etchPacketEid
      )
      await storeDocuments(etchPacketEid, zipBuffer)
      break
    }
  }

  res.json({ status: 'ok' })
})
```

Register webhooks programmatically:

```typescript
const { data } = await anvilClient.requestGraphQL({
  query: `mutation CreateWebhook(
    $action: String!,
    $objectType: String!,
    $objectEid: String!,
    $url: String!
  ) {
    createWebhookAction(
      action: $action
      objectType: $objectType
      objectEid: $objectEid
      url: $url
    ) {
      eid
    }
  }`,
  variables: {
    action: 'etchPacketComplete',
    objectType: 'EtchPacket',
    objectEid: etchPacketEid,
    url: 'https://your-app.com/webhooks/anvil',
  },
})
```

---

## Template / Field Mapping

| DropboxSign Concept | Anvil Equivalent |
|-------------------|-----------------|
| Template | Cast (PDF template) |
| Template ID | `castEid` |
| Role (e.g., "Client", "Manager") | Signer `id` (arbitrary string you define) |
| Merge field | Field alias in `data.payloads` |
| Template field (signer fills in) | Field assigned to signer via `fields[]` |
| Signing group | Multiple signers with same `routingOrder` |

### Mapping roles to signers

DropboxSign templates use named roles that signers are assigned to. In Anvil, you define signer IDs and explicitly map them to fields:

```typescript
// DropboxSign: role-based
signers: [
  { role: 'Client', email_address: 'jane@example.com', name: 'Jane Smith' },
  { role: 'Manager', email_address: 'bob@example.com', name: 'Bob Jones' },
]

// Anvil: ID-based with explicit field mapping
signers: [
  {
    id: 'client',  // replaces the "Client" role
    name: 'Jane Smith',
    email: 'jane@example.com',
    signerType: 'email',
    fields: [
      { fileId: 'doc1', fieldId: 'clientSignature' },
      { fileId: 'doc1', fieldId: 'clientDate' },
    ],
  },
  {
    id: 'manager',  // replaces the "Manager" role
    name: 'Bob Jones',
    email: 'bob@example.com',
    signerType: 'email',
    routingOrder: 2,  // signs after client
    fields: [
      { fileId: 'doc1', fieldId: 'managerSignature' },
      { fileId: 'doc1', fieldId: 'managerDate' },
    ],
  },
]
```

---

## Authentication Mapping

| DropboxSign | Anvil | Notes |
|------------|-------|-------|
| `HELLOSIGN_API_KEY` | `ANVIL_API_KEY` | Single key for all operations |
| `HELLOSIGN_CLIENT_ID` | N/A | Anvil doesn't need a separate client ID |
| `DROPBOX_SIGN_API_KEY` | `ANVIL_API_KEY` | |
| `DROPBOX_SIGN_CLIENT_ID` | N/A | |
| OAuth (multi-tenant) | Separate orgs or API keys | See feature-parity.md |

---

## Document Download

### Before (DropboxSign)

```typescript
// Download completed documents
const response = await client.signatureRequest.download(signatureRequestId, {
  file_type: 'pdf',
})
```

### After (Anvil)

```typescript
// Download all documents as a zip (includes signing certificate)
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  etchPacketEid
)

// The zip contains:
// - Each signed PDF
// - The signing certificate (audit trail)
```

Always download and store the signing certificate alongside signed documents for legal compliance. See the `anvil-document-sdk` skill for document storage patterns.
