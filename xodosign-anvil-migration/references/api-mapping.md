# Apryse Xodo Sign (eversign) → Anvil API Mapping Reference

This document maps the Apryse Xodo Sign / **eversign** REST API to its Anvil Etch E-Sign
equivalents. Use it when rewriting integration code. For Anvil implementation
patterns (client setup, Etch packets, embedded signing, webhooks, downloads),
reference the `anvil-document-sdk` skill rather than reimplementing them here.

> **Source note.** The eversign facts below are drawn from the official `eversign`
> Node SDK (`api.eversign.com`, the `Client`/`Document`/`Template`/`Signer`/field
> classes, and the log-event names). One item the SDK does **not** cover — the
> webhook `event_hash` signature recipe — is flagged inline; confirm it against the
> eversign dashboard/webhook settings before relying on it.

---

## SDK / Package Mapping

| Xodo Sign / eversign | Anvil |
|----------------------|-------|
| `eversign` (Node SDK) | `@anvilco/anvil` |
| Direct REST calls to `https://api.eversign.com/api/` | `@anvilco/anvil` |
| eversign embedded signing (`embedded_signing_url` in an iframe) | `@anvilco/anvil-embed-frame` |

eversign splits work across a `Client` plus `Document` / `Template` / `Signer` /
`Recipient` / `File` / field classes. Anvil uses a **single client** for all
operations.

---

## Client Initialization

### Before (eversign)

The eversign client is constructed with an API access key **and** a Business ID.
Every REST call carries `access_key` and `business_id` as query parameters.

```typescript
const { Client } = require('eversign')
const client = new Client(
  process.env.EVERSIGN_API_KEY,
  process.env.EVERSIGN_BUSINESS_ID
)
// Raw REST equivalent:
//   POST https://api.eversign.com/api/document?access_key=<key>&business_id=<id>
```

If the Business ID is omitted, the SDK calls `GET /business` and selects the
primary business before the first request.

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single long-lived API key. No `business_id`, no business selection, no OAuth
handshake. Multi-tenant integrations that used eversign's OAuth-on-behalf or several
businesses resolve a *per-tenant* credential instead — an Anvil OAuth token for the
tenant's own organization, or that tenant's child-org API key. See
`feature-parity.md`.

---

## Document Creation → Etch Packet Creation

eversign's `POST /document` (create a document, optionally from a template) maps to
Anvil's `createEtchPacket`. The template path (`createDocumentFromTemplate`) is the
common one for migrations.

### Before (eversign — create from a template)

```typescript
const { Client, Template, Signer, Field } = require('eversign')
const client = new Client(apiKey, businessId)

const template = new Template()
template.setTemplateId('tmpl_abc123')     // which template to instantiate
template.setTitle('NDA for Acme Corp')
template.setMessage('Please review and sign the attached NDA.')
// template.setSandbox(true)              // test document

const signer = new Signer()
signer.setRole('Client')                  // matches a role placeholder on the template
signer.setName('Jane Smith')
signer.setEmail('jane@example.com')
template.appendSigner(signer)

const field = new Field()                 // a template merge field
field.setIdentifier('company_name')
field.setValue('Acme Corp')
template.appendField(field)

const doc = await client.createDocumentFromTemplate(template)
const documentHash = doc.getDocumentHash()
```

Raw REST body: `{ sandbox, template_id, title, message, signers: [{ role, name, email, order }], fields: [{ identifier, value }] }`.

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',                          // ← eversign title
    isDraft: false,
    isTest: true,                                       // ← eversign sandbox
    signatureEmailSubject: 'Please sign this NDA',
    signatureEmailBody: 'Please review and sign the attached NDA.', // ← eversign message
    files: [
      { id: 'ndaDoc', castEid: 'xyz789...' },           // ← mapped from template_id
    ],
    signers: [
      {
        id: 'client',                                   // ← eversign role
        name: 'Jane Smith',
        email: 'jane@example.com',
        signerType: 'email',
        routingOrder: 1,                                // ← eversign order
        fields: [
          { fileId: 'ndaDoc', fieldId: 'clientSignature' }, // field alias from the template
        ],
      },
    ],
    data: {
      payloads: {
        ndaDoc: {
          data: {
            company_name: 'Acme Corp',                  // ← eversign field identifier + value
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

| eversign field | Anvil equivalent | Notes |
|----------------|------------------|-------|
| `template_id` | `files[].castEid` | Each template/document becomes a file entry with its `castEid` |
| (`is_draft` unset → sends) | (default — packet sends) | Anvil sends on create unless `isDraft: true` |
| `is_draft: true` | `isDraft: true` | Saves the packet as a draft |
| `title` | `name` | Packet display name |
| `message` | `signatureEmailBody` | Placed alongside signing instructions, does not replace them |
| N/A (title is reused) | `signatureEmailSubject` | Customize the signing email subject |
| `signers[].role` | `signers[].id` | Arbitrary string ID that links signer → fields |
| `signers[].name` / `.email` | `signers[].name` / `.email` | |
| `signers[].order` (+ `use_signer_order`) | `signers[].routingOrder` | Integer; equal values sign in parallel |
| `fields[].{identifier, value}` (merge) | `data.payloads.{fileId}.data` | Keyed by field alias (`identifier`) |
| positioned field `value` (prefill) | `data.payloads.{fileId}.data` | Keyed by field alias |
| `embedded_signing` + signer | `signers[].signerType: 'embedded'` | See embedded signing below |
| `recipients[]` (CC) | `signers[]` with no signature fields, or app-level | See feature-parity.md |
| `custom_requester_name` / `custom_requester_email` | `replyToName` / `replyToEmail` | Sender/reply-to identity |
| `redirect` / `redirect_decline` | signer `redirectURL` / `AnvilEmbedFrame` `onEvent` | Post-sign redirect |
| `expires` / `reminders` | Store in your own DB / app-level | See feature-parity.md |
| `meta` | Store in your own DB | Anvil has no metadata bag on packets |
| `pin` / SMS auth | Signer auth (app-level) | See feature-parity.md |
| `sandbox` | `isTest` | Watermarked, non-billed |

> Creating a document from **raw files** instead of a template
> (`client.createDocument` with `appendFile` + `appendFormField`) collapses the
> same way: each `File` becomes a `files[]` entry (upload the PDF as a Cast first),
> each positioned `FormField` becomes a tagged field on that Cast, and each field's
> `value` becomes a `data.payloads` entry.

---

## Embedded / Captive Signing

eversign embedded signing = set `embedded_signing` on the document
(`setEmbeddedSigningEnabled(true)`); the created document's signers then carry an
`embedded_signing_url` (no email is sent unless `deliver_email` is set). Anvil's =
mark the signer `signerType: 'embedded'`, then call `generateEtchSignURL`.

### Before (eversign)

```typescript
const document = new Document()
document.setTitle('NDA for Acme Corp')
document.setEmbeddedSigningEnabled(true)   // API field: embedded_signing

const signer = new Signer()
signer.setName('Jane Smith')
signer.setEmail('jane@example.com')
// signer.setDeliverEmail(true)            // optional: also email the signer
document.appendSigner(signer)
// ... appendFile + appendFormField ...

const doc = await client.createDocument(document)
const signUrl = doc.getSigners()[0].getEmbeddedSigningUrl() // iframe this URL
```

### After (Anvil)

```typescript
// 1. Mark the signer embedded at packet creation time:
//    signers: [{ id: 'client', signerType: 'embedded', ... }]

// 2. Generate the sign URL
const { data } = await anvilClient.generateEtchSignURL({
  variables: {
    signerEid,                    // from the createEtchPacket response
    clientUserId: 'app-user-42',  // your app's user ID, for the audit trail
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
          // Replaces eversign's redirect / iframe 'signed' event
        }
        if (event.action === 'signerError') console.error('Signing error:', event)
      }}
    />
  )
}
```

**Important:** Before using embedded signing, enable iframe embedding and allowlist
your domains in the Anvil dashboard at
`https://app.useanvil.com/org/<org-slug>/settings/api`.

### The one switch: email vs embedded

| | eversign | Anvil |
|--|----------|-------|
| Email signing | `embedded_signing` off (signer gets an email) | `signerType: 'email'` |
| Embedded signing | `embedded_signing` on → `embedded_signing_url` | `signerType: 'embedded'` + `generateEtchSignURL` |

### Embedded event mapping

eversign's embedded flow completes via a post-sign `redirect` / `redirect_decline`
URL, and its iframe emits JS events. Map both to `AnvilEmbedFrame`'s `onEvent`:

| eversign embedded outcome | Anvil `onEvent` action |
|---------------------------|------------------------|
| iframe `signed` / `redirect` reached | `signerComplete` |
| iframe `declined` / `redirect_decline` reached | N/A (see feature-parity.md for decline flow) |
| iframe `error` | `signerError` |

> The exact eversign iframe event names are part of the eversign embedded
> (client-side) docs, not the REST SDK — confirm them if you rely on the iframe
> events rather than the redirect URLs.

---

## Webhook / Event Mapping (eversign events → Anvil webhooks)

eversign delivers events by POSTing to a webhook URL configured in the business
settings (dashboard), and records the same events on the document's log. Anvil
registers webhooks with `createWebhookAction`. The eversign event-type names below
are authoritative (they are the document log-event names).

| eversign `event_type` | Anvil event | Notes |
|-----------------------|-------------|-------|
| `document_signed` | `signerComplete` | Fires per signer |
| `document_completed` | `etchPacketComplete` | All signers done — documents downloadable |
| `document_sent` | N/A (create returns the packet state) | |
| `document_viewed` | N/A | Not exposed as an Anvil event |
| `document_declined` | N/A (app-level decline) | See feature-parity.md |
| `document_cancelled` | N/A (app-level void) | See feature-parity.md |
| `document_expired` | N/A (app-level) | See feature-parity.md |

### Before (eversign — webhook handler + hash verification)

```typescript
import crypto from 'crypto'

app.post('/webhooks/eversign', express.json(), (req, res) => {
  const { event_hash, event_time, event_type } = req.body

  // eversign signs each event. The hash is an HMAC-SHA256 over event_time +
  // event_type, keyed by your API access key.
  // NOTE: verify-eversign-webhook — this recipe is NOT covered by the eversign
  // SDK; confirm the exact string + algorithm in the eversign dashboard webhook
  // settings before trusting it in production.
  const computed = crypto
    .createHmac('sha256', process.env.EVERSIGN_API_KEY)
    .update(String(event_time) + String(event_type))
    .digest('hex')
  if (computed !== event_hash) return res.status(401).send('Invalid signature')

  switch (event_type) {
    case 'document_signed':
      await handleSignerComplete(req.body.meta?.related_document_hash, req.body)
      break
    case 'document_completed':
      await downloadAndStoreDocuments(req.body.meta?.related_document_hash)
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

| eversign concept | Anvil equivalent |
|------------------|------------------|
| Template (`is_template` document) | Cast (PDF template), addressed by `castEid` |
| `template_id` | `castEid` |
| Signer role (`role`, e.g. "Client") | Signer `id` (arbitrary string you define) |
| Form field (`signature`, `text`, …) | Field with an alias, assigned to a signer |
| Field `identifier` | Field alias (`aliasId`) — your data key |
| Field `value` / merge field | Prefilled data via `data.payloads` |
| `order` | `signers[].routingOrder` |

### eversign field type → Anvil field type

eversign form fields are positioned with pixel `x`/`y`, a 1-based `page`,
`width`/`height`, and a `file_index`, and are assigned to a signer via `signer`.
Anvil's Document AI re-detects field boxes on the uploaded PDF, so eversign
coordinates inform **verification and re-tagging**, not a direct geometry import.

| eversign field type | Anvil field type |
|---------------------|------------------|
| `signature` | `signature` |
| `initials` | `initial` |
| `date_signed` | `signatureDate` |
| `text` | `shortText` |
| `note` | `shortText` (label / instruction text) |
| `checkbox` / `checkboxGroup` | `checkbox` |
| `radio` (with `group`) | `radioGroup` (with child options) |
| `dropdown` (with `options`) | `dropdown` |
| `attachment` | dropped (signer file upload — no Anvil fill-field equivalent) |

Field `validation_type` refines the Anvil type: `email_address` → `email`,
`numbers_only` → `number`, `letters_only` → `shortText`. A template **merge field**
(`{identifier, value}`) is **fill data**, not a signer field — key it into
`data.payloads` by `identifier`.

See `template-migration.md` for how templates move to Anvil (PDF + Document AI by
default; dynamic docs for content-based templates).

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates — the
counterpart to eversign's `GET /document?type=templates` and
`getDocumentByHash`. They're useful for verifying a migration and for building
"pick a template" UIs.

**All of these requests require authentication** — an Anvil API key. The GraphQL
queries below go through the authenticated client (`new Anvil({ apiKey })` →
`requestGraphQL`); the PDF download authenticates with the API key too (see below).
None of these are anonymous endpoints.

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
org has many templates. List only lightweight fields (`eid`, `title`, `name`) here,
then fetch a single template's `config` on demand.

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
after an import to confirm the fields you expect.

### Download a template's underlying PDF

The raw PDF for a Cast is available by `castEid` — the counterpart to eversign's
`download_raw_document`:

```
https://app.useanvil.com/download/cast/<castEid>.pdf?versionNumber=<n>
```

This download is **authenticated** — send your Anvil API key as HTTP Basic auth
(the API key as the username, empty password), the same convention as Anvil's other
REST endpoints:

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
never anonymously accessible.

---

## Authentication Mapping

| eversign | Anvil | Notes |
|----------|-------|-------|
| `access_key` (query param) | `ANVIL_API_KEY` | Single key for everything |
| `business_id` (query param) | N/A — or a child org per business | One org per key; in multi-tenant setups the child org *is* the business |
| OAuth `Bearer` token (multi-business) | Anvil OAuth app, or a child org (+ its own API key) per tenant | Both supported — see feature-parity.md |

---

## Document Download

### Before (eversign)

```typescript
// Raw (original, unsigned) document
await client.downloadRawDocumentToPath(doc, './raw.pdf')
// Final (completed) document, with the Audit Trail appended
await client.downloadFinalDocumentToPath(doc, './final.pdf', true)
// Raw REST: GET /download_final_document?...&document_hash=<hash>&audit_trail=1
```

### After (Anvil)

```typescript
// One zip containing every signed PDF AND the signing certificate
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Anvil's `downloadDocuments` returns the signed documents **and** the signing
certificate (eversign's Audit Trail) in a single zip — you don't fetch them
separately. Always store the certificate alongside the signed documents for legal
compliance. See the `anvil-document-sdk` skill for storage patterns.
