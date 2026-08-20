# Adobe Acrobat Sign → Anvil API Mapping Reference

This document maps Adobe Sign's eSign REST API (v6) to its Anvil Etch E-Sign
equivalents. Use it when rewriting integration code. For Anvil implementation
patterns (client setup, Etch packets, embedded signing, webhooks, downloads),
reference the `anvil-document-sdk` skill rather than reimplementing them here.

---

## SDK / Package Mapping

| Adobe Sign | Anvil |
|------------|-------|
| `adobe-sign-sdk` / community Node client | `@anvilco/anvil` |
| Generated `swagger_client` (from the v6 OpenAPI spec) | `@anvilco/anvil` |
| Direct REST calls to `{apiAccessPoint}api/rest/v6` | `@anvilco/anvil` |
| Adobe Sign embedded signing (an `esignUrl` in an iframe) | `@anvilco/anvil-embed-frame` |

Adobe Sign has no first-party Node SDK — integrations use a community package or a
raw HTTP client against the v6 REST API. Anvil uses a **single client** for all
operations.

---

## Client Initialization

### Before (Adobe Sign — OAuth or Integration Key, then base-URI discovery)

Every v6 call runs on the account's **data-center host**, which you must discover —
either from `api_access_point` in the OAuth token response, or by calling
`GET /baseUris`. Auth is a Bearer token (an OAuth access token or an Integration
Key); an optional `x-api-user` header impersonates a specific account user.

```typescript
// 1a. OAuth: refresh an access token (client_id/secret + refresh_token).
const tokenRes = await fetch('https://api.na1.adobesign.com/oauth/v2/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ADOBE_SIGN_CLIENT_ID!,
    client_secret: process.env.ADOBE_SIGN_CLIENT_SECRET!,
    refresh_token: process.env.ADOBE_SIGN_REFRESH_TOKEN!,
  }),
})
const { access_token, api_access_point } = await tokenRes.json()

// 1b. …or just use a long-lived Integration Key instead of the OAuth dance:
// const access_token = process.env.ADOBE_SIGN_INTEGRATION_KEY

// 2. Resolve the API base URI (skip if you already have api_access_point).
const baseRes = await fetch('https://api.adobesign.com/api/rest/v6/baseUris', {
  headers: { Authorization: `Bearer ${access_token}` },
})
const { apiAccessPoint } = await baseRes.json()
const baseUri = `${apiAccessPoint}api/rest/v6` // e.g. https://api.na1.adobesign.com/api/rest/v6

// 3. Every call carries the Bearer token (+ optional x-api-user impersonation).
const authHeaders = {
  Authorization: `Bearer ${access_token}`,
  'x-api-user': `email:${process.env.ADOBE_SIGN_SENDER_EMAIL}`,
}
```

### After (Anvil)

```typescript
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })
```

A single long-lived API key on one fixed host. No token refresh, no `baseUris`
discovery, no `x-api-user` impersonation.

---

## Agreement Creation → Etch Packet Creation

Adobe Sign's `POST /agreements` (send an agreement from a library document or a
transient document) maps to Anvil's `createEtchPacket`. Adobe's transient-upload →
create flow collapses to one synchronous call.

### Before (Adobe Sign — send from a library document)

```typescript
// (For an ad-hoc file you'd first POST /transientDocuments as multipart/form-data
//  and use the returned transientDocumentId. For a template, use libraryDocumentId.)

const res = await fetch(`${baseUri}/agreements`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    fileInfos: [{ libraryDocumentId: 'CBJCHBCAABAA...' }],
    name: 'NDA for Acme Corp',
    participantSetsInfo: [
      {
        memberInfos: [{ email: 'jane@example.com' }],
        order: 1,
        role: 'SIGNER',
      },
    ],
    signatureType: 'ESIGN',
    state: 'IN_PROCESS', // send now ('DRAFT'/'AUTHORING' would hold it)
    mergeFieldInfo: [
      { fieldName: 'CompanyName', defaultValue: 'Acme Corp' },
    ],
  }),
})
const { id: agreementId } = await res.json()
```

### After (Anvil)

```typescript
const { statusCode, data, errors } = await anvilClient.createEtchPacket({
  variables: {
    name: 'NDA for Acme Corp',
    isDraft: false,   // Adobe state: 'IN_PROCESS'
    isTest: true,     // watermarked, non-billed while developing
    files: [
      {
        id: 'ndaDoc',
        castEid: 'xyz789...', // mapped from the Adobe libraryDocumentId
      },
    ],
    signers: [
      {
        id: 'signer',              // replaces the participant role
        name: 'Jane Smith',
        email: 'jane@example.com',
        signerType: 'email',
        routingOrder: 1,           // Adobe participant set 'order'
        fields: [
          { fileId: 'ndaDoc', fieldId: 'signature' }, // field alias from the template
        ],
      },
    ],
    data: {
      payloads: {
        ndaDoc: {
          data: {
            CompanyName: 'Acme Corp', // Adobe mergeFieldInfo, keyed by field alias
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

| Adobe Sign field | Anvil equivalent | Notes |
|------------------|------------------|-------|
| `fileInfos[].libraryDocumentId` | `files[].castEid` | Template → Cast (from Phase 4) |
| `fileInfos[].transientDocumentId` | `files[].castEid` | Upload the file to Anvil as a Cast first |
| `name` | `name` | Agreement/packet display name |
| `message` | `signatureEmailBody` | Placed alongside signing instructions, doesn't replace them |
| `state: 'IN_PROCESS'` | (default — packet sends) | Anvil sends on create unless `isDraft: true` |
| `state: 'DRAFT'` / `'AUTHORING'` | `isDraft: true` | Save as a draft (see the authoring note below) |
| `participantSetsInfo[].role` | `signers[].id` | Arbitrary string ID that links signer → fields |
| `participantSetsInfo[].memberInfos[].email` | `signers[].email` | |
| member name (extended member info) | `signers[].name` | Anvil takes the name explicitly |
| `participantSetsInfo[].order` | `signers[].routingOrder` | Integer; equal values sign in parallel |
| `mergeFieldInfo[]` (`{ fieldName, defaultValue }`) | `data.payloads.{fileId}.data` | Keyed by field alias |
| `signatureType: 'ESIGN'` | (default — e-sign) | `'WRITTEN'` (wet-ink) has no direct Anvil path |
| embedded (suppress emails + fetch signing URL) | `signers[].signerType: 'embedded'` | See embedded signing below |
| `ccs[]` | `signers[]` with no signature fields, or app-level notification | See feature-parity.md |
| `externalId` / custom fields | Store in your own DB | Anvil has no metadata bag on packets |
| `postSignOption` / redirect | `AnvilEmbedFrame` `onEvent` (embedded) | Handle in your app |
| N/A | `replyToName` / `replyToEmail` | Customize the reply-to on signing emails |

> **v6 form fields are an *authoring* step, not a create field.** In v5 you passed
> `formFields` on `POST /agreements`; in v6 you create the agreement in
> `state: "AUTHORING"` and then place fields with `PUT /agreements/{id}/formFields`
> (`GET` reads them). Migrating templates makes this moot — a Cast already carries
> its fields — so **drop the authoring dance entirely** in the rewrite.

---

## Embedded / Captive Signing

Adobe Sign embedded signing = create the agreement (suppressing signer emails via
`emailOption`), then `GET /agreements/{id}/signingUrls` and iframe the returned
`esignUrl`. Anvil's = mark the signer `signerType: 'embedded'`, then call
`generateEtchSignURL`.

### Before (Adobe Sign)

```typescript
// After POST /agreements (with emails suppressed), fetch the signing URLs:
const res = await fetch(`${baseUri}/agreements/${agreementId}/signingUrls`, {
  headers: authHeaders,
})
const body = await res.json()
// Shape: { signingUrlSetInfos: [ { signingUrls: [ { email, esignUrl } ] } ] }
const signUrl = body.signingUrlSetInfos[0].signingUrls[0].esignUrl // iframe or redirect
```

### After (Anvil)

```typescript
// 1. Mark the signer embedded at packet creation time:
//    signers: [{ id: 'signer', signerType: 'embedded', ... }]

// 2. Generate the sign URL
const { data } = await anvilClient.generateEtchSignURL({
  variables: {
    signerEid,                   // from the createEtchPacket response
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
          // Redirect or update UI — replaces reading the Adobe return/redirect
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

| | Adobe Sign | Anvil |
|--|------------|-------|
| Email signing | Default — Adobe emails each participant an `esignUrl` | `signerType: 'email'` |
| Embedded signing | Suppress emails (`emailOption`) **and** fetch `signingUrls` | `signerType: 'embedded'` + `generateEtchSignURL` |

Adobe splits embedded signing across two concerns — *whether an email is sent* and
*fetching the URL*. Anvil's `signerType` does both: `'embedded'` sends no email and
enables the sign URL.

---

## Webhook Event Mapping (Adobe Sign Webhooks → Anvil webhooks)

Adobe Sign delivers events via the Webhooks API — register with `POST /webhooks`
(scope `RESOURCE` for a single agreement, or `USER`/`GROUP`/`ACCOUNT`). Anvil
registers webhooks with `createWebhookAction`.

| Adobe Sign event (`webhookSubscriptionEvents`) | Anvil event | Notes |
|------------------------------------------------|-------------|-------|
| `AGREEMENT_ACTION_COMPLETED` | `signerComplete` | Fires when a participant completes their action |
| `AGREEMENT_WORKFLOW_COMPLETED` | `etchPacketComplete` | All participants done — documents downloadable |
| `AGREEMENT_CREATED` | N/A (create returns the state) | |
| `AGREEMENT_ACTION_DELEGATED` | N/A (app-level) | See feature-parity.md |
| `AGREEMENT_EXPIRED` | N/A (app-level) | See feature-parity.md |
| `AGREEMENT_REJECTED` / declined | N/A (app-level decline) | See feature-parity.md |
| `AGREEMENT_EMAIL_VIEWED` / `_ACTION_REQUESTED` | N/A | Not exposed as Anvil events |

### Before (Adobe Sign — register + client-id intent verification)

```typescript
// Register a webhook for one agreement (RESOURCE scope).
await fetch(`${baseUri}/webhooks`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'agreement-complete',
    scope: 'RESOURCE',
    resourceType: 'AGREEMENT',
    resourceId: agreementId,
    state: 'ACTIVE',
    webhookSubscriptionEvents: [
      'AGREEMENT_ACTION_COMPLETED',
      'AGREEMENT_WORKFLOW_COMPLETED',
    ],
    webhookEndpointInfo: { url: 'https://your-app.com/webhooks/adobesign' },
  }),
})

// Handler — Adobe verifies the endpoint by replaying the request and expecting the
// client id echoed back (on registration GET *and* on every delivered event).
app.post('/webhooks/adobesign', express.json(), async (req, res) => {
  const clientId = req.header('X-AdobeSign-ClientId')
  if (clientId !== process.env.ADOBE_SIGN_WEBHOOK_CLIENT_ID) {
    return res.status(401).send('Invalid client id')
  }
  res.set('X-AdobeSign-ClientId', clientId).status(200).json({ xAdobeSignClientId: clientId })

  const event = req.body
  switch (event.event) {
    case 'AGREEMENT_ACTION_COMPLETED':
      await handleSignerComplete(event.agreement.id, event)
      break
    case 'AGREEMENT_WORKFLOW_COMPLETED':
      await downloadAndStoreDocuments(event.agreement.id)
      break
  }
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

Register the webhook after creating the packet (see the `anvil-document-sdk` skill's
webhook reference for the full helper):

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

The `X-AdobeSign-ClientId` echo/intent-verification handshake goes away — use
Anvil's webhook verification instead.

---

## Template / Field Mapping

| Adobe Sign concept | Anvil equivalent |
|--------------------|------------------|
| Library document (template) | Cast (PDF template), addressed by `castEid` |
| `libraryDocumentId` | `castEid` |
| Participant role (`SIGNER`, `APPROVER`, …) | Signer `id` (arbitrary string you define) |
| Form field | Field with an alias, assigned to a signer |
| Form-field name | Field alias (`aliasId`) — your data key |
| `mergeFieldInfo` default value | Prefilled data via `data.payloads` |
| `participantSetsInfo[].order` | `signers[].routingOrder` |

### Adobe form-field type → Anvil field type

Adobe library documents are **flat PDFs**, so the migration re-detects fields with
Anvil Document AI (there is no lossless JSON converter as with DocuSign). Use this
table when **re-tagging** the detected fields in the Anvil template editor:

| Adobe form field | Anvil field type |
|------------------|------------------|
| Signature | `signature` |
| Initials | `initial` |
| Signature date (auto) | `signatureDate` |
| Signer name / title / company | `fullName` / `shortText` |
| Email | `email` |
| Text field | `shortText` |
| Text field (number format) | `number` |
| Checkbox | `checkbox` |
| Radio button group | `radioGroup` |
| Dropdown / list box | `dropdown` |
| Hyperlink, file attachment, payment | dropped (not a fillable data field) |

See `template-migration.md` for the export → upload → re-tag flow.

---

## Listing & Reading Anvil Templates (Casts)

Anvil has first-class endpoints for enumerating and inspecting templates — the
counterpart to Adobe's `GET /libraryDocuments` and
`GET /libraryDocuments/{id}`. They're useful for verifying a migration and for
building "pick a template" UIs.

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

**Keep the list light.** A Cast's `config` (its full field/box layout) can be large,
so requesting `config` for every item can produce a huge response when an org has
many templates. List only lightweight fields (`eid`, `title`, `name`) here, then
fetch a single template's `config` on demand.

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

The raw PDF for a Cast is available by `castEid` — the counterpart to Adobe's
`GET /libraryDocuments/{id}/combinedDocument`:

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
never anonymously accessible. Handy for spot-checking that an imported template
rendered the PDF you expected.

---

## Authentication Mapping

| Adobe Sign | Anvil | Notes |
|------------|-------|-------|
| OAuth2 `client_id` / `client_secret` + scopes | `ANVIL_API_KEY` | Single key for everything |
| OAuth `access_token` / `refresh_token` | N/A | No token exchange or refresh |
| Integration Key (Bearer) | `ANVIL_API_KEY` | Both Adobe modes collapse to one key |
| `GET /baseUris` → `api_access_point` (shard host) | N/A | Single fixed host, no discovery |
| `x-api-user` (sender impersonation) | N/A | Access control lives in your app |
| Webhook `X-AdobeSign-ClientId` verification | Anvil webhook verification | See `anvil-document-sdk` webhook reference |
| OAuth on behalf of other accounts (multi-tenant) | Separate orgs or API keys | See feature-parity.md |

Adobe scopes look like `agreement_write:self`, `library_read:self`,
`webhook_write:self` (a `<resource>_<action>:<modifier>` shape). Anvil's single key
carries the org's full access — there are no per-call scopes to map.

---

## Document Download

### Before (Adobe Sign — two separate fetches)

```typescript
// Combined signed PDF of all documents
const combined = await fetch(`${baseUri}/agreements/${agreementId}/combinedDocument`, { headers: authHeaders })
const combinedPdf = Buffer.from(await combined.arrayBuffer())

// Audit trail (the signing certificate) — a separate call
const audit = await fetch(`${baseUri}/agreements/${agreementId}/auditTrail`, { headers: authHeaders })
const auditPdf = Buffer.from(await audit.arrayBuffer())
```

### After (Anvil)

```typescript
// One zip containing every signed PDF AND the signing certificate
const { statusCode, data: zipBuffer } = await anvilClient.downloadDocuments(
  documentGroupEid // from the etchPacketComplete webhook, or the packet
)
```

Anvil's `downloadDocuments` returns the signed documents **and** the signing
certificate in a single zip — you don't fetch `combinedDocument` and `auditTrail`
separately. Always store the certificate alongside the signed documents for legal
compliance. See the `anvil-document-sdk` skill for storage patterns.
