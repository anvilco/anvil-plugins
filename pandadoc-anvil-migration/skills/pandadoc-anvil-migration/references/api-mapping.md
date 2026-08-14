# PandaDoc → Anvil API Mapping Reference

This document maps PandaDoc's public API (v1) to its Anvil Etch E-Sign
equivalents. Use it when rewriting integration code. For Anvil implementation
patterns (client setup, Etch packets, embedded signing, webhooks, downloads),
reference the `anvil-document-sdk` skill rather than reimplementing them here.

**Base facts.** PandaDoc: `https://api.pandadoc.com/public/v1`, `Authorization:
API-Key <key>`, snake_case JSON. Anvil: single API key, camelCase GraphQL.

---

## SDK / Package Mapping

| PandaDoc | Anvil |
|----------|-------|
| `pandadoc-node-client` (official SDK) | `@anvilco/anvil` |
| Direct REST calls to `api.pandadoc.com/public/v1` | `@anvilco/anvil` |
| PandaDoc signing session embed (`app.pandadoc.com/s/{id}` in an iframe) | `@anvilco/anvil-embed-frame` |

---

## Client Initialization

### Before (PandaDoc)

```typescript
import { Configuration, DocumentsApi } from 'pandadoc-node-client'
const config = new Configuration({ apiKey: `API-Key ${process.env.PANDADOC_API_KEY}` })
const documentsApi = new DocumentsApi(config)
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single client for all operations. Note PandaDoc's **sandbox vs production** split
is by API key; Anvil uses `isTest: true` on individual packets instead of a
separate key environment.

---

## Roles vs Fields vs Tokens — the model to translate

PandaDoc separates three concepts that all collapse onto Anvil primitives:

| PandaDoc | What it is | Anvil equivalent |
|----------|-----------|------------------|
| **Role** | A named signer/recipient slot on a template | Signer (`signers[]`) |
| **Field** | An on-page widget (signature, text, checkbox…) assigned to a role | A field on a Cast, assigned to a signer via `fields[]` |
| **Token** | A `{{merge}}` variable in body text, no on-page widget | Prefill **data** (`data.payloads`), not a signer field |

Keep this mapping in mind throughout — PandaDoc's tokens do **not** become signer
fields.

---

## Document Creation → Etch Packet Creation

PandaDoc creating + sending a document is a **multi-step, asynchronous** flow;
Anvil's `createEtchPacket` is a single synchronous call.

### Before (PandaDoc — create from template, poll, send)

```typescript
// 1. Create (async — returns status "document.uploaded")
const created = await documentsApi.createDocument({
  documentCreateRequest: {
    name: 'MSA – Acme Corp',
    templateUuid: 'BhVzRcxH9Z2LgfPPGXFUBa',
    recipients: [
      { email: 'john@example.com', firstName: 'John', lastName: 'Doe', role: 'Client', signingOrder: 1 },
    ],
    tokens: [{ name: 'Client.CompanyName', value: 'Acme Corp' }],
    fields: { net_terms: { value: 'Net 30', role: 'Client' } },
  },
})

// 2. Poll until status === "document.draft"
let doc = await documentsApi.statusDocument({ id: created.id })
while (doc.status !== 'document.draft') {
  await new Promise((r) => setTimeout(r, 2000))
  doc = await documentsApi.statusDocument({ id: created.id })
}

// 3. Send (emails signers)
await documentsApi.sendDocument({
  id: created.id,
  documentSendRequest: { subject: 'Please sign: MSA', message: 'Hi John…', silent: false },
})
```

### After (Anvil — one call)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'MSA for Acme Corp',
    isDraft: false,
    isTest: true,
    signatureEmailSubject: 'Please sign: MSA',   // → PandaDoc send subject
    signatureEmailBody: 'Hi John…',              // → PandaDoc send message
    files: [{ id: 'msa', castEid: 'xyz789...' }], // mapped from template_uuid
    signers: [
      {
        id: 'client',              // → PandaDoc role "Client"
        name: 'John Doe',
        email: 'john@example.com',
        signerType: 'email',
        routingOrder: 1,           // → PandaDoc signing_order
        fields: [{ fileId: 'msa', fieldId: 'clientSignature' }],
      },
    ],
    data: {
      payloads: {
        msa: {
          data: {
            netTerms: 'Net 30',       // → PandaDoc field value
            CompanyName: 'Acme Corp', // → PandaDoc token value
          },
        },
      },
    },
  },
})

if (errors) throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
const etchPacketEid = data?.data?.createEtchPacket?.eid
```

**Anvil sends synchronously** — no `document.uploaded → document.draft` polling
and no separate send call. Drop the poll loop entirely.

### Field Mapping

| PandaDoc field | Anvil equivalent | Notes |
|----------------|------------------|-------|
| `template_uuid` | `files[].castEid` | Mapped from the migrated template |
| `name` | `name` | Packet display name |
| `recipients[].role` | `signers[].id` | Links signer → fields |
| `recipients[].first_name`+`last_name` | `signers[].name` | Combine into one name |
| `recipients[].email` | `signers[].email` | |
| `recipients[].signing_order` | `signers[].routingOrder` | Equal values sign in parallel |
| recipient with no `role` (cc) | non-signing recipient / app-level | See feature-parity.md |
| `fields{}` (widgets) | `data.payloads.{fileId}.data` | Keyed by field alias |
| `tokens[]` (merge vars) | `data.payloads.{fileId}.data` | Also fill data — not signer fields |
| send `silent: false` | `signerType: 'email'` | Anvil emails signers |
| send `silent: true` | `signerType: 'embedded'` | You host the signing UI |
| create → poll → send | single `createEtchPacket` call | Anvil sends synchronously |

---

## Embedded / Captive Signing

PandaDoc: send silently, then create a signing **session** and embed
`app.pandadoc.com/s/{id}`. Anvil: mark the signer embedded, then generate a sign
URL and embed with `AnvilEmbedFrame`.

### Before (PandaDoc)

```typescript
// 1. Send silently (no signer emails)
await documentsApi.sendDocument({ id, documentSendRequest: { silent: true } })

// 2. Create a signing session for the recipient
const session = await documentsApi.createDocumentLink({
  id,
  documentCreateLinkRequest: { recipient: 'john@example.com', lifetime: 900 },
})

// 3. Embed the session in an iframe
const url = `https://app.pandadoc.com/s/${session.id}`
```

### After (Anvil)

```typescript
// 1. Mark the signer embedded at packet creation:
//    signers: [{ id: 'client', signerType: 'embedded', ... }]

// 2. Generate the sign URL
const { data } = await anvilClient.generateEtchSignURL({
  variables: { signerEid, clientUserId: 'app-user-42' },
})
const signUrl = data?.data?.generateEtchSignURL
```

```tsx
// 3. Embed (React)
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

function SigningPage({ signURL }: { signURL: string }) {
  return (
    <AnvilEmbedFrame
      iframeURL={signURL}
      onEvent={(event) => {
        if (event.action === 'signerComplete') { /* redirect / update UI */ }
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

| | PandaDoc | Anvil |
|--|----------|-------|
| Email signing | `send` with `silent: false` | `signerType: 'email'` |
| Embedded signing | `send silent: true` + `session` | `signerType: 'embedded'` + `generateEtchSignURL` |

---

## Webhook Event Mapping

PandaDoc uses **webhook subscriptions**; Anvil registers webhooks with
`createWebhookAction`.

| PandaDoc trigger | Anvil event | Notes |
|------------------|-------------|-------|
| `recipient_completed` | `signerComplete` | Fires per signer |
| `document_state_changed` → `data.status == "document.completed"` | `etchPacketComplete` | All signers done |
| `document_completed_pdf_ready` | `etchPacketComplete` | Signed PDF downloadable — safe download trigger |
| `document_state_changed` → `document.declined` | N/A (app-level) | See feature-parity.md |
| `document_updated` | N/A | Not exposed as an Anvil event |

> PandaDoc has **no single `document_completed` trigger** — completion is
> `document_state_changed` with `status == "document.completed"`, and/or
> `document_completed_pdf_ready`. Map both onto Anvil's `etchPacketComplete`.

### Before (PandaDoc — subscription + HMAC verification)

```typescript
// Register a subscription (once)
await fetch('https://api.pandadoc.com/public/v1/webhook-subscriptions', {
  method: 'POST',
  headers: { Authorization: `API-Key ${process.env.PANDADOC_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'completion-hook',
    url: 'https://your-app.com/webhooks/pandadoc',
    active: true,
    triggers: ['document_state_changed', 'recipient_completed', 'document_completed_pdf_ready'],
    payload: ['recipients', 'fields', 'tokens'],
  }),
})

// Handler — verify HMAC-SHA256 over the RAW body using the subscription shared key
import crypto from 'crypto'

app.post('/webhooks/pandadoc', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('x-pd-signature')
  const computed = crypto.createHmac('sha256', process.env.PANDADOC_WEBHOOK_KEY).update(req.body).digest('hex')
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed))) {
    return res.status(401).send('Invalid signature')
  }
  const events = JSON.parse(req.body.toString()) // PandaDoc posts an array
  for (const evt of events) {
    if (evt.event === 'recipient_completed') await handleSignerComplete(evt.data.id, evt)
    if (evt.event === 'document_state_changed' && evt.data.status === 'document.completed') {
      await downloadAndStore(evt.data.id)
    }
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
    case 'signerComplete':
      await handleSignerComplete(data.etchPacketEid, data)
      break
    case 'etchPacketComplete': {
      const { data: zipBuffer } = await anvilClient.downloadDocuments(data.documentGroupEid)
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

| PandaDoc concept | Anvil equivalent |
|------------------|------------------|
| Template (`GET /templates/{id}/details`) | Cast (PDF template) or dynamic doc, addressed by `castEid` |
| Template UUID (`template_uuid`) | `castEid` |
| Role (`roles[].name`) | Signer `id` |
| Field (`fields[].type`, `assigned_to`) | Field with an alias, assigned to a signer |
| Field `field_id` / `merge_field` | Field alias (`aliasId`) |
| Token (`tokens[].name`) | Prefill data key (not a signer field) |
| `signing_order` | `signers[].routingOrder` |

### Field type → Anvil field type

| PandaDoc field type | Anvil field type |
|---------------------|------------------|
| `signature` | `signature` |
| `initials` | `initial` |
| `text` | `shortText` (or `longText`) |
| `date` | `date` |
| `checkbox` | `checkbox` |
| `radio_buttons` | `radioGroup` |
| `dropdown` | dropdown (`shortText` with values) |
| `collect_file` | signer attachment (see feature-parity.md) |
| `payment_details` | out of scope (PDF-fill + sign) |

See `template-migration.md` for how templates are migrated (PandaDoc has no
flat-PDF export, so the strategy differs from DocuSign).

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates. They're
useful for verifying a migration and for building "pick a template" UIs.

**All of these requests require authentication** — an Anvil API key. The GraphQL
queries below go through the authenticated client (`new Anvil({ apiKey })` →
`requestGraphQL`); the PDF download authenticates with the API key too. None are
anonymous endpoints.

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
org has many templates. List only lightweight fields (`eid`, `title`, `name`),
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

### Download a template's underlying PDF

The raw PDF for a Cast is available by `castEid`:

```
https://app.useanvil.com/download/cast/<castEid>.pdf?versionNumber=<n>
```

This download is **authenticated** — send your Anvil API key as HTTP Basic auth
(the API key as the username, empty password):

```typescript
const auth = 'Basic ' + Buffer.from(`${process.env.ANVIL_API_KEY}:`).toString('base64')
const res = await fetch(
  `https://app.useanvil.com/download/cast/${castEid}.pdf?versionNumber=1`,
  { headers: { Authorization: auth } }
)
```

The dashboard also exposes a pre-signed variant (with an `&h=<hash>` signature).
Either way, the PDF is never anonymously accessible.

---

## Authentication Mapping

| PandaDoc | Anvil | Notes |
|----------|-------|-------|
| `PANDADOC_API_KEY` (`API-Key` header) | `ANVIL_API_KEY` | Single key for everything |
| Sandbox vs production key | `isTest: true` per packet | Anvil doesn't split by key environment |
| OAuth2 (act on behalf of other accounts) | Separate orgs or API keys | See feature-parity.md |
| `PANDADOC_WEBHOOK_KEY` (`x-pd-signature`) | Anvil webhook verification | See `anvil-document-sdk` webhook reference |

---

## Document Download

### Before (PandaDoc)

```typescript
const pdf = await documentsApi.downloadDocument({ id }) // certificate included
```

### After (Anvil)

```typescript
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Anvil's `downloadDocuments` returns the signed documents **and** the signing
certificate in a single zip. Always store the certificate alongside the signed
documents for legal compliance. See the `anvil-document-sdk` skill for storage
patterns.
