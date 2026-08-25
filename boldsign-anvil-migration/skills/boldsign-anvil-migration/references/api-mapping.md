# BoldSign → Anvil API Mapping Reference

This document maps BoldSign's e-signature REST API to its Anvil Etch E-Sign
equivalents. Use it when rewriting integration code. For Anvil implementation
patterns (client setup, Etch packets, embedded signing, webhooks, downloads),
reference the `anvil-document-sdk` skill rather than reimplementing them here.

The "before" snippets show BoldSign's **REST** request shapes (endpoints and field
names verified against the official docs). The `boldsign` Node SDK
(`DocumentApi` / `TemplateApi`) wraps these same endpoints — the JSON field names
below are what its request models carry.

---

## SDK / Package Mapping

| BoldSign | Anvil |
|----------|-------|
| `boldsign` (Node SDK) | `@anvilco/anvil` |
| Direct REST calls to `api.boldsign.com/v1` | `@anvilco/anvil` |
| BoldSign embedded signing (`signLink` in an iframe) | `@anvilco/anvil-embed-frame` |

BoldSign splits its API into resource classes (`DocumentApi`, `TemplateApi`, plus
others). Anvil uses a **single client** for all operations.

---

## Client Initialization

### Before (BoldSign)

BoldSign authenticates with an `X-API-KEY` header (or an OAuth 2.0 Bearer token).
The base URL is **region-specific** — US is the default `https://api.boldsign.com`;
EU is `https://eu-api.boldsign.com`.

```typescript
import { Configuration, DocumentApi, TemplateApi } from 'boldsign'

const config = new Configuration({
  apiKey: process.env.BOLDSIGN_API_KEY,
  // EU accounts must point at the EU host:
  // basePath: 'https://eu-api.boldsign.com/v1',
})

const documentApi = new DocumentApi(config)
const templateApi = new TemplateApi(config)
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single long-lived API key. No region-specific host, no OAuth token exchange, no
account discovery. Multi-tenant integrations that used BoldSign's OAuth-on-behalf
resolve a *per-tenant* credential instead — an Anvil OAuth token for the tenant's
own organization, or that tenant's child-org API key. See `feature-parity.md`.

---

## Document Send → Etch Packet Creation

BoldSign's "send document from a template" (`POST /v1/template/send?templateId=…`)
maps to Anvil's `createEtchPacket`. (A raw send — `POST /v1/document/send` with an
uploaded file + positioned form fields — maps the same way once the PDF is a
published Cast.)

### Before (BoldSign — send from a template)

```typescript
// POST https://api.boldsign.com/v1/template/send?templateId=tmpl_abc123
// Fields on a template are attached to ROLES (by roleIndex), not to people.
const body = {
  title: 'NDA for Acme Corp',
  message: 'Hi, please review and sign the attached NDA.',
  enableSigningOrder: true,
  roles: [
    {
      roleIndex: 1,                 // matches a role slot defined on the template
      signerName: 'Jane Smith',
      signerEmail: 'jane@example.com',
      signerType: 'Signer',
      signerOrder: 1,
      // Prefill values for fields already on the template, by field id:
      existingFormFields: [
        { id: 'CompanyName', value: 'Acme Corp' },
      ],
    },
  ],
  cc: [{ emailAddress: 'records@acme.com' }],
}

const res = await fetch('https://api.boldsign.com/v1/template/send?templateId=tmpl_abc123', {
  method: 'POST',
  headers: { 'X-API-KEY': process.env.BOLDSIGN_API_KEY!, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const { documentId } = await res.json()
```

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',
    isDraft: false,
    isTest: true,
    signatureEmailSubject: 'Please sign this NDA',        // → BoldSign title/subject
    signatureEmailBody: 'Hi, please review and sign the attached NDA.', // → BoldSign message
    files: [
      {
        id: 'ndaDoc',
        castEid: 'xyz789...', // mapped from the BoldSign templateId
      },
    ],
    signers: [
      {
        id: 'signer',            // replaces BoldSign roleIndex / signerRole
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
            CompanyName: 'Acme Corp', // → BoldSign existingFormFields value, keyed by field alias
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

| BoldSign field | Anvil equivalent | Notes |
|----------------|------------------|-------|
| `templateId` | `files[].castEid` | Each template becomes a file entry with its `castEid` |
| (send is synchronous) | (default — packet sends) | Anvil sends on create unless `isDraft: true` |
| draft / not-yet-sent | `isDraft: true` | Saves the packet as a draft |
| `title` / `subject` | `signatureEmailSubject` | |
| `message` | `signatureEmailBody` | Placed alongside signing instructions, does not replace them |
| `roles[].roleIndex` / `signerRole` | `signers[].id` | Arbitrary string ID that links signer → fields |
| `roles[].signerName` | `signers[].name` | |
| `roles[].signerEmail` | `signers[].email` | |
| `roles[].signerOrder` (+ `enableSigningOrder`) | `signers[].routingOrder` | Integer; equal values sign in parallel |
| `existingFormFields[].value` / form field `value` | `data.payloads.{fileId}.data` | Keyed by field alias |
| `signerType: 'InPersonSigner'` | `signers[].signerType: 'embedded'` | See embedded signing below |
| `cc[]` | `signers[]` with no signature fields, or app-level notification | See feature-parity.md |
| `authenticationCode` / `authenticationType` (access code / SMS / email OTP) | Signer auth (app-level) | See feature-parity.md |
| `labels` / metadata | Store in your own DB | Anvil has no metadata bag on packets |
| `expiryDays`, `reminderSettings` | App-level scheduling | See feature-parity.md |
| dashboard webhook config | `createWebhookAction` | See webhooks below |
| N/A | `replyToName` / `replyToEmail` | Customize the reply-to on signing emails |

---

## Embedded / In-App Signing

BoldSign has **two** embedded surfaces — keep them straight, because they map to
different Anvil features:

1. **Embedded signing** (a *signer* signs inside your app) —
   `GET /v1/document/getEmbeddedSignLink` returns a per-signer `signLink`. This maps
   to Anvil's `generateEtchSignURL`.
2. **Embedded request/sending** (a *sender* prepares + sends inside your app) —
   `POST /v1/document/createEmbeddedRequestUrl` (and the template variant) returns a
   URL to the BoldSign sender/preparation UI. This maps to Anvil's **embedded
   packet builder**, not to the sign URL. Both render through `AnvilEmbedFrame`, but
   the builder is a distinct surface — see feature-parity.md.

The common case (a signer signing in-app) is below.

### Before (BoldSign — embedded signing)

```typescript
// After the document is created, fetch a short-lived per-signer sign link.
const url =
  'https://api.boldsign.com/v1/document/getEmbeddedSignLink' +
  `?documentId=${documentId}&signerEmail=jane@example.com` +
  '&redirectUrl=https://your-app.com/bs-return'
const res = await fetch(url, { headers: { 'X-API-KEY': process.env.BOLDSIGN_API_KEY! } })
const { signLink } = await res.json() // embed signLink in an iframe (single-use, short-lived)
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
          // Redirect or update UI — replaces BoldSign's redirectUrl handling
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

| | BoldSign | Anvil |
|--|----------|-------|
| Email signing | `signerType: 'Signer'` — BoldSign emails the signer | `signerType: 'email'` |
| Embedded signing | `getEmbeddedSignLink` → `signLink` in an iframe | `signerType: 'embedded'` + `generateEtchSignURL` |

### Embedded event mapping

| BoldSign iframe / redirect event | Anvil `onEvent` action |
|----------------------------------|------------------------|
| `onSigningCompleted` / redirect success | `signerComplete` |
| `onDocumentSigned` | `signerComplete` |
| `onDeclined` | N/A (see feature-parity.md for decline flow) |
| link expired / `onSessionExpired` | Regenerate the sign URL |
| `onError` | `signerError` |

---

## Webhook Event Mapping (BoldSign webhooks → Anvil webhooks)

BoldSign delivers events to an endpoint **configured in the dashboard**
(Settings → API → Webhooks, account- or app-scoped), verified with an
`X-BoldSign-Signature` HMAC-SHA256 over the raw body using a dedicated webhook
secret. Anvil registers webhooks **programmatically** with `createWebhookAction`,
per object (or per org) — so the migration drops the dashboard config + HMAC check
and adds a registration call. BoldSign fires ~12 document events; only the two
completion-lifecycle events have direct Anvil equivalents.

| BoldSign event | Anvil event | Notes |
|----------------|-------------|-------|
| `Signed` | `signerComplete` | Fires per signer |
| `Completed` | `etchPacketComplete` | All signers done — documents downloadable |
| `Sent` | N/A (create returns the packet state) | |
| `Viewed` | N/A | Not exposed as an Anvil event |
| `Declined` | N/A (app-level decline) | See feature-parity.md |
| `Revoked` / `Voided` | N/A (app-level void) | See feature-parity.md |
| `Expired` | N/A (app-level expiration) | See feature-parity.md |
| `Reassigned` | N/A | Not exposed |
| `SenderIdentityVerified` | N/A | Not exposed |
| `BehalfDocumentSigned` / `BehalfDocumentCompleted` | `signerComplete` / `etchPacketComplete` | On-behalf sends emit the same two events, on the acting org's webhook |

### Before (BoldSign — dashboard webhook + HMAC verification)

```typescript
import crypto from 'crypto'

// Endpoint + events are set in the BoldSign dashboard, not in the send call.
app.post('/webhooks/boldsign', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('X-BoldSign-Signature')
  const computed = crypto
    .createHmac('sha256', process.env.BOLDSIGN_WEBHOOK_SECRET!)
    .update(req.body) // raw bytes
    .digest('base64')
  if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    return res.status(401).send('Invalid signature')
  }

  const event = JSON.parse(req.body.toString())
  switch (event.event?.eventType) {
    case 'Signed':
      await handleSignerComplete(event.data.documentId, event)
      break
    case 'Completed':
      await downloadAndStoreDocuments(event.data.documentId)
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
skill's webhook reference for the full helper):

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

| BoldSign concept | Anvil equivalent |
|------------------|------------------|
| Template | Cast (PDF template), addressed by `castEid` |
| `templateId` | `castEid` |
| Role (`roleIndex`, `signerRole`, e.g. "Customer") | Signer `id` (arbitrary string you define) |
| Form field (`Signature`, `Textbox`, …) | Field with an alias, assigned to a signer |
| Form field `id` / `name` | Field alias (`aliasId`) — your data key |
| Form field `bounds` {x, y, width, height} + `pageNumber` | Field rectangle + page in the Anvil Cast |
| Form field `value` / `existingFormFields` | Prefilled data via `data.payloads` |
| `signerOrder` | `signers[].routingOrder` |

### Form-field type → Anvil field type

| BoldSign `fieldType` | Anvil field type |
|----------------------|------------------|
| `Signature` | `signature` |
| `Initial` | `initial` |
| `DateSigned` | `signatureDate` |
| `EditableDate` | `date` |
| `Textbox` | `shortText` |
| `Name` | `fullName` |
| `Email` | `email` |
| `CheckBox` | `checkbox` |
| `RadioButton` | `radioGroup` (with child options) |
| `Dropdown` | `dropdown` (carries the list values) |
| `Label` | `shortText` (read-only, prefilled) / fill data |
| `Image` | `image` |
| `Attachment` | signer attachment |
| `Hyperlink` | dropped (static link, not a fillable field) |

BoldSign positions every field by absolute `bounds` on a `pageNumber`. When you
migrate the template's PDF into Anvil (see `template-migration.md`), Document AI
re-detects field rectangles; use the exported field manifest to confirm each
field's page, position, and type, then re-tag and alias in the Anvil editor.

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates — the
counterpart to BoldSign's `GET /v1/template/list` and
`GET /v1/template/properties`. They're useful for verifying a migration and for
building "pick a template" UIs.

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
after an import to confirm the detected fields match what you expect.

### Download a template's underlying PDF

The raw PDF for a Cast is available by `castEid` — the counterpart to BoldSign's
`GET /v1/template/download`:

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

| BoldSign | Anvil | Notes |
|----------|-------|-------|
| `X-API-KEY` header | `ANVIL_API_KEY` (Bearer, via the client) | Single key for everything |
| OAuth 2.0 Bearer (Client Credentials / Auth Code) | API key, or an Anvil OAuth app for multi-tenant | Single-tenant integrations just use the API key; see feature-parity.md for OAuth |
| Region host (`api.boldsign.com` / `eu-api.boldsign.com`) | N/A | One global endpoint; the client handles it |
| `X-BoldSign-Signature` (webhook HMAC secret) | Anvil webhook verification | See `anvil-document-sdk` webhook reference |
| OAuth on behalf of other accounts (multi-tenant) | Anvil OAuth app, or a child org (+ its own API key) per tenant | Both supported — see feature-parity.md |
| Sandbox key / sandbox mode | `isTest: true` + development key | Watermarked, non-billed |

---

## Document Download

### Before (BoldSign)

```typescript
// Signed PDF for the document
const pdfRes = await fetch(
  `https://api.boldsign.com/v1/document/download?documentId=${documentId}`,
  { headers: { 'X-API-KEY': process.env.BOLDSIGN_API_KEY! } }
)
const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())

// Audit-trail certificate is a SEPARATE call
const auditRes = await fetch(
  `https://api.boldsign.com/v1/document/downloadAuditLog?documentId=${documentId}`,
  { headers: { 'X-API-KEY': process.env.BOLDSIGN_API_KEY! } }
)
const auditBuffer = Buffer.from(await auditRes.arrayBuffer())
```

### After (Anvil)

```typescript
// One zip containing every signed PDF AND the signing certificate
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Anvil's `downloadDocuments` returns the signed documents **and** the signing
certificate in a single zip — unlike BoldSign, you don't fetch the audit trail
separately. Always store the certificate alongside the signed documents for legal
compliance. See the `anvil-document-sdk` skill for storage patterns.
