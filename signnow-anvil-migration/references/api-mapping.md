# signNow → Anvil API Mapping Reference

This document maps signNow's (airSlate SignNow's) REST API to its Anvil Etch
E-Sign equivalents. Use it when rewriting integration code. For Anvil
implementation patterns (client setup, Etch packets, embedded signing, webhooks,
downloads), reference the `anvil-document-sdk` skill rather than reimplementing
them here.

> **Verification note.** signNow's API docs host (`docs.signnow.com`) was not
> directly reachable while authoring this reference; endpoints and shapes below
> were confirmed against signNow's official docs summaries and the official
> `@signnow/api-client` / SDK repos. Items marked **(verify)** are the ones to
> re-check against the live docs before relying on them.

---

## SDK / Package Mapping

| signNow | Anvil |
|---------|-------|
| `@signnow/api-client` (official Node SDK) | `@anvilco/anvil` |
| `signnow` (legacy npm package, superseded by `@signnow/api-client`) | `@anvilco/anvil` |
| Direct REST calls to `api.signnow.com` (`api.eval-signnow.com` in sandbox) | `@anvilco/anvil` |
| Embedded signing iframe (the `/link` URL in an iframe) | `@anvilco/anvil-embed-frame` |

signNow splits work across many endpoints (`/oauth2/token`, `/document`,
`/template/{id}/copy`, `/document/{id}/invite`, `/v2/documents/{id}/embedded-invites`,
`/api/v2/events`, `/document/{id}/download`). Anvil uses a **single client** for all
operations.

---

## Client Initialization

### Before (signNow — two-step OAuth2)

signNow authenticates in **two steps**: a Basic client credential
(`base64(client_id:client_secret)`) is accepted **only** at `POST /oauth2/token`,
which returns a Bearer **access token**; every other endpoint requires
`Authorization: Bearer <access_token>`.

```typescript
// Step 1 — exchange the Basic client credential for a Bearer access token.
const basic = Buffer.from(
  `${process.env.SIGNNOW_CLIENT_ID}:${process.env.SIGNNOW_CLIENT_SECRET}`
).toString('base64')

const tokenRes = await fetch('https://api.signnow.com/oauth2/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${basic}`,          // Basic — client_id:client_secret
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'password',                    // password grant (or authorization_code / refresh_token)
    username: process.env.SIGNNOW_USERNAME!,
    password: process.env.SIGNNOW_PASSWORD!,
  }),
})
const { access_token } = await tokenRes.json()

// Step 2 — every other call uses the Bearer token.
const headers = { Authorization: `Bearer ${access_token}` }
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single long-lived API key. **No Basic → Bearer exchange, no client
id/secret, no token refresh.** The two-step handshake collapses to one constructor.
Multi-tenant integrations that used signNow's authorization-code or password grant
resolve a *per-tenant* credential instead — an Anvil OAuth token for the tenant's own
organization, or that tenant's child-org API key. See `feature-parity.md`.

---

## Field Invite → Etch Packet Creation

signNow's "send a template for signature" is a **multi-call sequence**: copy the
template into a document, (optionally) prefill it, then send a role-based **field
invite**. Anvil collapses all of it into a single `createEtchPacket`.

### Before (signNow — copy template, prefill, field invite)

```typescript
// 1. Create a document from the template.
const copyRes = await fetch(`https://api.signnow.com/template/${templateId}/copy`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ document_name: 'NDA for Acme Corp' }),
})
const { id: documentId } = await copyRes.json()

// 2. Prefill non-signature fields (editable by the signer).
await fetch(`https://api.signnow.com/v2/documents/${documentId}/prefill-texts`, {
  method: 'PUT',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fields: [{ field_name: 'CompanyName', prefilled_text: 'Acme Corp' }],
  }),
})

// 3. Send a role-based field invite (signing order via `order`).
await fetch(`https://api.signnow.com/document/${documentId}/invite`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'sender@yourco.com',
    to: [
      { email: 'jane@example.com', role: 'Signer 1', role_id: '<roleId>', order: 1 },
    ],
    subject: 'Please sign this NDA',
    message: 'Hi, please review and sign the attached NDA.',
  }),
})
```

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',
    isDraft: false,
    isTest: true,
    signatureEmailSubject: 'Please sign this NDA',       // → invite subject
    signatureEmailBody: 'Hi, please review and sign the attached NDA.', // → invite message
    files: [
      { id: 'ndaDoc', castEid: 'xyz789...' },            // mapped from the signNow templateId
    ],
    signers: [
      {
        id: 'signer1',           // replaces the signNow role "Signer 1"
        name: 'Jane Smith',
        email: 'jane@example.com',
        signerType: 'email',
        routingOrder: 1,         // → invite `order`
        fields: [
          { fileId: 'ndaDoc', fieldId: 'signature' },    // field alias from the template
        ],
      },
    ],
    data: {
      payloads: {
        ndaDoc: {
          data: {
            CompanyName: 'Acme Corp',  // → prefill-texts value, keyed by field alias
          },
        },
      },
    },
  },
})

if (errors) throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
const etchPacketEid = data?.data?.createEtchPacket?.eid
```

Anvil sends synchronously on create unless `isDraft: true` — **drop the
copy → prefill → invite sequence**; one call does all three.

### Field Mapping

| signNow | Anvil equivalent | Notes |
|---------|------------------|-------|
| `POST /template/{id}/copy` (templateId) | `files[].castEid` | Each document becomes a file entry with its `castEid` |
| copy `document_name` | `name` | Packet display name |
| (send immediately) | (default — packet sends) | Anvil sends on create unless `isDraft: true` |
| (save as draft) | `isDraft: true` | Saves the packet as a draft |
| invite `subject` | `signatureEmailSubject` | |
| invite `message` | `signatureEmailBody` | Placed alongside signing instructions, does not replace them |
| invite `to[].role` | `signers[].id` | Arbitrary string ID that links signer → fields |
| invite `to[].email` | `signers[].email` | |
| invite `to[].order` | `signers[].routingOrder` | Integer; equal values sign in parallel |
| `prefill-texts` (`field_name`/`prefilled_text`) | `data.payloads.{fileId}.data` | Keyed by field alias |
| embedded invite | `signers[].signerType: 'embedded'` | See embedded signing below |
| `cc[]` | `signers[]` with no signature fields, or app-level notification | See feature-parity.md |
| invite `authentication`/`phone` (signer auth) | Signer auth (app-level) | See feature-parity.md |
| (no document metadata bag) | Store in your own DB | Anvil has no metadata bag on packets |
| event subscription | `createWebhookAction` | See webhooks below |
| eval host / sandbox | `isTest: true` | Watermarked, non-billed |
| N/A | `replyToName` / `replyToEmail` | Customize the reply-to on signing emails |

---

## Embedded / Captive Signing

signNow's captive signing is a **two-call** flow: create an embedded invite, then
generate its signing link. Anvil's is `signerType: 'embedded'` +
`generateEtchSignURL`.

### Before (signNow)

```typescript
// 1. Create an embedded invite (no email is sent). Returns per-signer invite ids.
const inviteRes = await fetch(
  `https://api.signnow.com/v2/documents/${documentId}/embedded-invites`,
  {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invites: [
        { email: 'jane@example.com', role_id: '<roleId>', order: 1, auth_method: 'none' },
      ],
    }),
  }
)
const { data: invites } = await inviteRes.json()
const fieldInviteId = invites[0].id

// 2. Generate the embedded signing link.
const linkRes = await fetch(
  `https://api.signnow.com/v2/documents/${documentId}/embedded-invites/${fieldInviteId}/link`,
  {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ auth_method: 'none', link_expiration: 45 }),
  }
)
const { data: { link } } = await linkRes.json()  // iframe or redirect to it
```

### After (Anvil)

```typescript
// 1. Mark the signer embedded at packet-creation time:
//    signers: [{ id: 'signer1', signerType: 'embedded', ... }]

// 2. Generate the sign URL.
const { data } = await anvilClient.generateEtchSignURL({
  variables: {
    signerEid,                   // from the createEtchPacket response
    clientUserId: 'app-user-42', // your app's user ID, for the audit trail
  },
})
const signUrl = data?.data?.generateEtchSignURL
```

```tsx
// 3. Client: open the signing UI (React).
import AnvilEmbedFrame from '@anvilco/anvil-embed-frame'

function SigningPage({ signURL }: { signURL: string }) {
  return (
    <AnvilEmbedFrame
      iframeURL={signURL}
      onEvent={(event) => {
        if (event.action === 'signerComplete') {
          // Redirect or update UI — replaces polling signNow's document status
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

| | signNow | Anvil |
|--|---------|-------|
| Email signing | Field invite (`POST /document/{id}/invite`) | `signerType: 'email'` |
| Embedded signing | Embedded invite + `/link` | `signerType: 'embedded'` + `generateEtchSignURL` |

### Embedded event mapping

| signNow signing outcome | Anvil `onEvent` action |
|-------------------------|------------------------|
| Signer finishes in the iframe | `signerComplete` |
| Link expired (`link_expiration`) | Regenerate the sign URL |
| Signer error | `signerError` |
| Decline | N/A (see feature-parity.md for decline flow) |

---

## Webhook Event Mapping (signNow Event Subscriptions → Anvil webhooks)

signNow delivers events via **Event Subscriptions (Webhooks 2.0)** — register a
callback per event with `POST /api/v2/events`. Anvil registers webhooks with
`createWebhookAction`.

| signNow event | Anvil event | Notes |
|---------------|-------------|-------|
| `document.complete` | `etchPacketComplete` | All recipients signed — documents downloadable (the download trigger) |
| `document.update` | `signerComplete` **(verify)** | Closest per-signer analog; signNow fires `document.update` as signing progresses, not a dedicated "one signer signed" event |
| `invite.update` | `signerComplete` **(verify)** | Field-invite state change |
| `document.create` | N/A | `createEtchPacket` returns the packet state |
| `invite.create` | N/A | |
| `document.delete` | N/A (app-level) | See feature-parity.md |

> **Per-signer parity gap.** Anvil's `signerComplete` fires once per signer.
> signNow v2 exposes `document.complete` (all done) cleanly, but the per-signer
> signal is coarser (`document.update` / `invite.update`). If you relied on a
> precise per-signer event, confirm the exact signNow event you were handling and
> map it deliberately. **(verify)**

### Before (signNow — register an event subscription + handler)

```typescript
// Register the callback (once per document, or account-wide).
await fetch('https://api.signnow.com/api/v2/events', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: 'document.complete',
    entity_id: documentId,          // scope to this document (omit for account-wide)
    action: 'callback',
    attributes: {
      callback: 'https://your-app.com/webhooks/signnow',
      use_tls_12: true,
      include_metadata: true,
    },
  }),
})

// Handler — signNow POSTs the event payload (verify the signature per your setup).
app.post('/webhooks/signnow', express.json(), async (req, res) => {
  const { meta, content } = req.body          // shape varies by event
  const documentId = content?.document_id
  switch (meta?.event) {
    case 'document.complete':
      await downloadAndStoreDocuments(documentId)
      break
    case 'document.update':
      await handleSignerProgress(documentId, req.body)
      break
  }
  res.sendStatus(200)
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

> signNow also has a legacy **Webhooks 1.0** (`POST /api/v1/event_subscription`).
> If your integration uses it, the mapping is the same — point the completion
> event at `etchPacketComplete`.

---

## Template / Field Mapping

| signNow concept | Anvil equivalent |
|-----------------|------------------|
| Template | Cast (PDF template), addressed by `castEid` |
| Template `id` | `castEid` |
| Role (e.g. "Signer 1") | Signer `id` (arbitrary string you define) |
| Field / element (positioned box) | Field with an alias, assigned to a signer |
| Field `field_name` / `label` | Field alias (`aliasId`) — your data key |
| `x` / `y` / `page_number` / `width` / `height` | Anvil field rectangle (re-detected by Document AI or re-tagged) |
| Prefill (`prefill-texts`) | Prefilled data via `data.payloads` |
| invite `order` | `signers[].routingOrder` |

signNow fields carry their coordinates (`x`, `y`, `page_number` — **0-based** —
`width`, `height`) inline on the document/template. Anvil re-establishes field
geometry during template migration (Document AI detection, then re-tagging) — see
`template-migration.md`.

### signNow field type → Anvil field type

| signNow field type | Anvil field type |
|---------------------|------------------|
| `signature` | `signature` |
| `initials` | `initial` |
| `text` | `shortText` |
| `text` (date validator) | `date` |
| auto date-signed | `signatureDate` |
| `checkbox` | `checkbox` |
| `radiobutton` | `radioGroup` (with child options) |
| `dropdown` / enumeration | dropdown (list) |
| `attachment` | signer attachment |
| `hyperlink`, `formula`, smart fields | dropped / handled app-level |

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates — the
counterpart to listing the signNow **Templates** folder and reading a template's
fields. They're useful for verifying a migration and for building "pick a template"
UIs.

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
after a migration to confirm the fields you expect were detected.

### Download a template's underlying PDF

The raw PDF for a Cast is available by `castEid` — the counterpart to signNow's
`GET /document/{templateId}/download`:

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
never anonymously accessible. Handy for spot-checking that a migrated template
rendered the PDF you expected.

---

## Authentication Mapping

| signNow | Anvil | Notes |
|---------|-------|-------|
| `SIGNNOW_CLIENT_ID` / `SIGNNOW_CLIENT_SECRET` (Basic credential) | `ANVIL_API_KEY` | Single key; no Basic → Bearer exchange |
| Bearer access token (from `POST /oauth2/token`) | `ANVIL_API_KEY` | No token exchange or refresh |
| `SIGNNOW_USERNAME` / `SIGNNOW_PASSWORD` (password grant) | N/A, or a child-org API key per tenant | Single-tenant needs no impersonation; multi-tenant maps to per-org credentials |
| `refresh_token` / token expiry handling | N/A | Anvil keys are long-lived |
| Eval host `api.eval-signnow.com` (sandbox) | `isTest: true` + dev key | Watermarked test packets |
| OAuth authorization-code grant (multi-tenant) | Anvil OAuth app, or a child org (+ its own API key) per tenant | Both supported — see feature-parity.md |

signNow's **two-step auth** (Basic client credential → `POST /oauth2/token` →
Bearer token on every other call) collapses to a single `ANVIL_API_KEY`.

---

## Document Download

### Before (signNow)

```typescript
// Flattened signed PDF (type: collapsed | zip | email)
const res = await fetch(
  `https://api.signnow.com/document/${documentId}/download?type=collapsed`,
  { headers }
)
const pdfBuffer = Buffer.from(await res.arrayBuffer())

// The signing history / audit trail is a SEPARATE download in signNow.
```

### After (Anvil)

```typescript
// One zip containing every signed PDF AND the signing certificate
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Where signNow returns the flattened PDF from `/download` and its **signing history /
audit trail separately**, Anvil's `downloadDocuments` returns the signed documents
**and** the signing certificate in a single zip — you don't fetch the certificate
separately. Always store the certificate alongside the signed documents for legal
compliance. See the `anvil-document-sdk` skill for storage patterns.
