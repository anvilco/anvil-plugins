# DocuSign → Anvil API Mapping Reference

This document maps DocuSign's eSignature REST API (v2.1) to its Anvil Etch E-Sign
equivalents. Use it when rewriting integration code. For Anvil implementation
patterns (client setup, Etch packets, embedded signing, webhooks, downloads),
reference the `anvil-document-sdk` skill rather than reimplementing them here.

---

## SDK / Package Mapping

| DocuSign | Anvil |
|----------|-------|
| `docusign-esign` (Node SDK) | `@anvilco/anvil` |
| Direct REST calls to `{base_uri}/restapi` | `@anvilco/anvil` |
| DocuSign embedded signing (recipient view URL in an iframe) | `@anvilco/anvil-embed-frame` |

DocuSign splits its API into resource classes (`EnvelopesApi`, `TemplatesApi`,
`EnvelopesApi.createRecipientView`, etc.). Anvil uses a **single client** for all
operations.

---

## Client Initialization

### Before (DocuSign — JWT or Auth Code grant)

DocuSign requires an OAuth token exchange, then discovery of the account's
`accountId` and per-account `base_uri` before any API call.

```typescript
import docusign from 'docusign-esign'

const apiClient = new docusign.ApiClient()
apiClient.setOAuthBasePath('account-d.docusign.com') // demo; 'account.docusign.com' in prod

// JWT grant (server-to-server)
const results = await apiClient.requestJWTUserToken(
  process.env.DOCUSIGN_INTEGRATION_KEY,
  process.env.DOCUSIGN_USER_ID,
  ['signature', 'impersonation'],
  Buffer.from(process.env.DOCUSIGN_PRIVATE_KEY),
  3600
)
const accessToken = results.body.access_token

// Discover accountId + base_uri — never hardcode these
const userInfo = await apiClient.getUserInfo(accessToken)
const account = userInfo.accounts.find((a) => a.isDefault === 'true')
apiClient.setBasePath(`${account.baseUri}/restapi`)
apiClient.addDefaultHeader('Authorization', `Bearer ${accessToken}`)
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single long-lived API key. No token refresh, no `accountId`/`base_uri`
discovery, no impersonation. Multi-tenant integrations that used DocuSign's
Authorization Code grant or SOBO resolve a *per-tenant* credential instead — an
Anvil OAuth token for the tenant's own organization, or that tenant's child-org API
key. See `feature-parity.md`.

---

## Envelope Creation → Etch Packet Creation

DocuSign's `POST /envelopes` (send an envelope from a template) maps to Anvil's
`createEtchPacket`.

### Before (DocuSign — send from a template)

```typescript
const envelopesApi = new docusign.EnvelopesApi(apiClient)

const envelope = {
  status: 'sent', // 'created' would save it as a draft
  templateId: 'adbc1234-...',
  emailSubject: 'Please sign this NDA',
  emailBlurb: 'Hi, please review and sign the attached NDA.',
  templateRoles: [
    {
      roleName: 'Signer',          // matches a role placeholder on the template
      name: 'Jane Smith',
      email: 'jane@example.com',
      routingOrder: '1',
      tabs: {
        textTabs: [
          { tabLabel: 'CompanyName', value: 'Acme Corp', locked: 'true' },
        ],
      },
    },
  ],
}

const results = await envelopesApi.createEnvelope(account.accountId, {
  envelopeDefinition: envelope,
})
const envelopeId = results.envelopeId
```

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',
    isDraft: false,
    isTest: true,
    signatureEmailSubject: 'Please sign this NDA',       // → DocuSign emailSubject
    signatureEmailBody: 'Hi, please review and sign the attached NDA.', // → emailBlurb
    files: [
      {
        id: 'ndaDoc',
        castEid: 'xyz789...', // mapped from the DocuSign templateId
      },
    ],
    signers: [
      {
        id: 'signer',            // replaces DocuSign roleName
        name: 'Jane Smith',
        email: 'jane@example.com',
        signerType: 'email',
        routingOrder: 1,
        fields: [
          { fileId: 'ndaDoc', fieldId: 'signature' }, // field alias from the template
        ],
      },
    ],
    data: {
      payloads: {
        ndaDoc: {
          data: {
            CompanyName: 'Acme Corp', // → DocuSign tab value, keyed by field alias
          },
        },
      },
    },
  },
})

if (errors) throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
const etchPacketEid = data?.data?.createEtchPacket?.eid
```

### Field Mapping

| DocuSign field | Anvil equivalent | Notes |
|----------------|------------------|-------|
| `templateId` | `files[].castEid` | Each document becomes a file entry with its `castEid` |
| `status: 'sent'` | (default — packet sends) | Anvil sends on create unless `isDraft: true` |
| `status: 'created'` | `isDraft: true` | Saves the packet as a draft |
| `emailSubject` | `signatureEmailSubject` | |
| `emailBlurb` | `signatureEmailBody` | Placed alongside signing instructions, does not replace them |
| `templateRoles[].roleName` | `signers[].id` | Arbitrary string ID that links signer → fields |
| `templateRoles[].name` | `signers[].name` | |
| `templateRoles[].email` | `signers[].email` | |
| `templateRoles[].routingOrder` | `signers[].routingOrder` | Integer; equal values sign in parallel |
| `templateRoles[].tabs.*.value` | `data.payloads.{fileId}.data` | Keyed by field alias |
| `templateRoles[].clientUserId` | `signers[].signerType: 'embedded'` | See embedded signing below |
| `carbonCopies[]` | `signers[]` with no signature fields, or app-level notification | See feature-parity.md |
| `recipients.signers[].accessCode` | Signer auth (app-level) | See feature-parity.md |
| `customFields` (envelope) | Store in your own DB | Anvil has no metadata bag on packets |
| `eventNotification` | `createWebhookAction` | See webhooks below |
| N/A | `replyToName` / `replyToEmail` | Customize the reply-to on signing emails |

---

## Embedded / Captive Signing

DocuSign's captive signing = set `clientUserId` on the recipient, then call
`createRecipientView` to get a signing URL. Anvil's = mark the signer
`signerType: 'embedded'`, then call `generateEtchSignURL`.

### Before (DocuSign)

```typescript
// 1. The recipient must have a clientUserId (makes them "captive" — no email sent)
//    Set clientUserId on the templateRole / signer at envelope creation time.

// 2. Generate the signing URL
const viewRequest = {
  returnUrl: 'https://your-app.com/ds-return',
  authenticationMethod: 'none',
  clientUserId: 'app-user-42',      // must match the recipient's clientUserId
  userName: 'Jane Smith',
  email: 'jane@example.com',
}

const results = await envelopesApi.createRecipientView(
  account.accountId,
  envelopeId,
  { recipientViewRequest: viewRequest }
)
const signUrl = results.url // single-use, short-lived — iframe or redirect to it
```

### After (Anvil)

```typescript
// 1. Mark the signer embedded at packet creation time:
//    signers: [{ id: 'signer', signerType: 'embedded', ... }]

// 2. Generate the sign URL
const { data } = await anvilClient.generateEtchSignURL({
  variables: {
    signerEid,                 // from the createEtchPacket response
    clientUserId: 'app-user-42', // your app's user ID, for the audit trail
  },
})
const signUrl = data?.data?.generateEtchSignURL
```

```tsx
// 3. Client: open the signing UI (React)
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

function SigningPage({ signURL }: { signURL: string }) {
  return (
    <AnvilEmbedFrame
      iframeURL={signURL}
      onEvent={(event) => {
        if (event.action === 'signerComplete') {
          // Redirect or update UI — replaces DocuSign's returnUrl?event=signing_complete
        }
        if (event.action === 'signerError') console.error('Signing error:', event)
      }}
    />
  )
}
```

**Important:** Before using embedded signing, enable iframe embedding and
allowlist your domains in the Anvil dashboard at
`https://app.useanvil.com/org/<org-slug>/settings/api`.

### The one switch: email vs embedded

| | DocuSign | Anvil |
|--|----------|-------|
| Email signing | Recipient has **no** `clientUserId` | `signerType: 'email'` |
| Embedded signing | Recipient **has** a `clientUserId` + `createRecipientView` | `signerType: 'embedded'` + `generateEtchSignURL` |

### Embedded event mapping

| DocuSign return event (`returnUrl?event=`) | Anvil `onEvent` action |
|--------------------------------------------|------------------------|
| `signing_complete` | `signerComplete` |
| `viewing_complete` | `signerComplete` (or user navigates away) |
| `decline` | N/A (see feature-parity.md for decline flow) |
| `session_timeout` / `ttl_expired` | Regenerate the sign URL |
| `exception` | `signerError` |

---

## Webhook Event Mapping (DocuSign Connect → Anvil webhooks)

DocuSign delivers events via **Connect** — either an account-level configuration
or a per-envelope `eventNotification` embedded in the create call. Anvil
registers webhooks with `createWebhookAction`.

| DocuSign event (`events[]`) | DocuSign classic status code | Anvil event | Notes |
|-----------------------------|------------------------------|-------------|-------|
| `recipient-completed` | `Completed` (recipient) | `signerComplete` | Fires per signer |
| `envelope-completed` | `Completed` (envelope) | `etchPacketComplete` | All signers done — documents downloadable |
| `envelope-sent` | `Sent` | N/A (create returns the packet state) | |
| `envelope-declined` | `Declined` | N/A (app-level decline) | See feature-parity.md |
| `envelope-voided` | `Voided` | N/A (app-level void) | See feature-parity.md |
| `recipient-sent` / `recipient-delivered` | `Sent` / `Delivered` | N/A | Not exposed as Anvil events |

### Before (DocuSign — per-envelope Connect + HMAC verification)

```typescript
// Registered inline on the envelope at creation:
envelope.eventNotification = {
  url: 'https://your-app.com/webhooks/docusign',
  loggingEnabled: 'true',
  requireAcknowledgment: 'true',
  includeHMAC: 'true',
  eventData: { version: 'restv2.1', format: 'json', includeData: ['recipients'] },
  events: ['envelope-completed', 'envelope-declined', 'recipient-completed'],
}

// Handler — verify the HMAC over the RAW body
import crypto from 'crypto'

app.post('/webhooks/docusign', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('X-DocuSign-Signature-1')
  const computed = crypto
    .createHmac('sha256', process.env.DOCUSIGN_HMAC_KEY)
    .update(req.body) // raw bytes
    .digest('base64')
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    return res.status(401).send('Invalid signature')
  }

  const event = JSON.parse(req.body.toString())
  switch (event.event) {
    case 'recipient-completed':
      await handleSignerComplete(event.data.envelopeId, event)
      break
    case 'envelope-completed':
      await downloadAndStoreDocuments(event.data.envelopeId)
      break
  }
  res.status(200).send('ok')
})
```

### After (Anvil)

```typescript
app.post('/webhooks/anvil', async (req, res) => {
  const { action, data } = req.body
  res.sendStatus(200)

  switch (action) {
    case 'signerComplete': {
      await handleSignerComplete(data.etchPacketEid, data)
      break
    }
    case 'etchPacketComplete': {
      const { data: zipBuffer } = await anvilClient.downloadDocuments(
        data.documentGroupEid
      )
      await storeDocuments(data.documentGroupEid, zipBuffer)
      break
    }
  }
})
```

Register the webhook after creating the packet (see the `anvil-document-sdk`
skill's webhook reference for the full `registerWebhook` helper):

```typescript
await anvilClient.requestGraphQL({
  query: `mutation CreateWebhook($action: String!, $objectType: String!, $objectEid: String!, $url: String!) {
    createWebhookAction(action: $action, objectType: $objectType, objectEid: $objectEid, url: $url) { eid }
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

| DocuSign concept | Anvil equivalent |
|------------------|------------------|
| Template (`envelopeTemplate`) | Cast (PDF template), addressed by `castEid` |
| `templateId` | `castEid` |
| Role placeholder (`roleName`, e.g. "Signer") | Signer `id` (arbitrary string you define) |
| Tab (`signHere`, `text`, ...) | Field with an alias, assigned to a signer |
| Tab `tabLabel` | Field alias (`aliasId`) — your data key |
| Tab `tabId` | Field `aliasId` (the converter uses `tabId`) |
| Tab `value` / `prefillTabs` | Prefilled data via `data.payloads` |
| `routingOrder` | `signers[].routingOrder` |

### Tab type → Anvil field type (used by the template converter)

| DocuSign tab | Anvil field type |
|--------------|------------------|
| `signHere` / `signHereOptional` | `signature` |
| `initialHere` / `initialHereOptional` | `initial` |
| `dateSigned` | `signatureDate` |
| `fullName` | `fullName` |
| `text` / `zip` / `list` | `shortText` |
| `number` | `number` |
| `email` / `emailAddress` | `email` |
| `ssn` | `shortText` (with `ssn` format) |
| `checkbox` | `checkbox` |
| `radioGroup` | `radioGroup` (with child options) |
| `note`, `approve`, `decline`, `draw`, `signerAttachment` | dropped (not converted) |

See `template-migration.md` for how the converter reconstructs these
automatically from a DocuSign template's JSON.

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates — the
counterpart to DocuSign's `GET /templates` and `GET /templates/{id}`. They're
useful for verifying a migration and for building "pick a template" UIs.

**All of these requests require authentication** — an Anvil API key. The GraphQL
queries below go through the authenticated client (`new Anvil({ apiKey })` →
`requestGraphQL`); the PDF download authenticates with the API key too (see
below). None of these are anonymous endpoints.

### List templates — `organization { casts }`

`casts` returns a paginated `CastPage` — `items` (an array of `Cast`), plus
`rowCount`, `pageCount`, `page`, and `pageSize`. Filter with `isTemplate`,
`isPublished`, `isDraft`, `isArchived`, and `query`; page with `limit`/`offset`.

```graphql
query ListTemplates($organizationEid: String!) {
  organization(eid: $organizationEid) {
    casts(isTemplate: true, isPublished: true, limit: 50, offset: 0) {
      items { eid title name }
      rowCount
      pageCount
      page
      pageSize
    }
  }
}
```

**Keep the list light.** A Cast's `config` (its full field/box layout) can be
large, so requesting `config` for every item can produce a huge response when an
org has many templates. List only lightweight fields (`eid`, `title`, `name`)
here, then fetch a single template's `config` on demand.

### Read one template's fields — `cast(eid)`

```graphql
query GetTemplate($eid: String!) {
  cast(eid: $eid) {
    eid
    title
    config   # field/box layout — fetch per-cast, not for the whole list
  }
}
```

Both run through the Anvil client's `requestGraphQL`. Use `cast(eid) { config }`
after an import to confirm the converter produced the fields you expect.

### Download a template's underlying PDF

The raw PDF for a Cast is available by `castEid` — the counterpart to DocuSign's
`GET /templates/{id}/documents/{documentId}`:

```
https://app.useanvil.com/download/cast/<castEid>.pdf?versionNumber=<n>
```

This download is **authenticated** — send your Anvil API key as HTTP Basic auth
(the API key as the username, empty password), the same convention as Anvil's
other REST endpoints:

```typescript
const auth = 'Basic ' + Buffer.from(`${process.env.ANVIL_API_KEY}:`).toString('base64')
const res = await fetch(
  `https://app.useanvil.com/download/cast/${castEid}.pdf?versionNumber=1`,
  { headers: { Authorization: auth } }
)
const pdfBuffer = Buffer.from(await res.arrayBuffer())
```

The dashboard also exposes a pre-signed variant of this URL (with an `&h=<hash>`
signature) that carries its own short-lived authorization. Either way, the PDF is
never anonymously accessible. Handy for spot-checking that an imported template
rendered the PDF you expected.

---

## Authentication Mapping

| DocuSign | Anvil | Notes |
|----------|-------|-------|
| `DOCUSIGN_INTEGRATION_KEY` (client ID) | `ANVIL_API_KEY` | Single key for everything |
| `DOCUSIGN_USER_ID` (impersonated user GUID) | N/A, or a child-org API key per tenant | Single-tenant needs no impersonation; multi-tenant maps to per-org credentials |
| `DOCUSIGN_PRIVATE_KEY` (JWT RSA key) | N/A | No JWT exchange |
| `DOCUSIGN_ACCOUNT_ID` / `base_uri` (from `userinfo`) | N/A — or the tenant's child org | No discovery call; in Option B the child org *is* the account |
| `DOCUSIGN_HMAC_KEY` (Connect HMAC secret) | Anvil webhook verification | See `anvil-document-sdk` webhook reference |
| OAuth Auth Code grant (multi-tenant) | Anvil OAuth app, or a child org (+ its own API key) per tenant | Both supported — see feature-parity.md |

---

## Document Download

### Before (DocuSign)

```typescript
// Combined PDF of all documents
const combined = await envelopesApi.getDocument(account.accountId, envelopeId, 'combined')
// Certificate of Completion (audit trail)
const certificate = await envelopesApi.getDocument(account.accountId, envelopeId, 'certificate')
```

### After (Anvil)

```typescript
// One zip containing every signed PDF AND the signing certificate
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Anvil's `downloadDocuments` returns the signed documents **and** the signing
certificate in a single zip — you don't fetch the certificate separately. Always
store the certificate alongside the signed documents for legal compliance. See
the `anvil-document-sdk` skill for storage patterns.
