# DropboxSign → Anvil Terminology

A vocabulary map from DropboxSign (formerly HelloSign) to Anvil. Use it to keep
names straight while reading the rest of the references. The full API mapping with
before/after code is in `api-mapping.md`; feature gaps are in `feature-parity.md`.

**Mental model in one line:** a DropboxSign *signature request* built from a
*template* becomes an Anvil *Etch packet* built from a *Cast*, and DropboxSign's
role/merge-field/embedded-signing concepts become Anvil signer IDs, field aliases,
and embedded signers.

| DropboxSign term | Anvil term | What it is |
|------------------|-----------|------------|
| Signature Request | Etch packet | The request you send to collect signatures. `createEtchPacket` returns an `etchPacketEid`. |
| `signature_request_id` | `etchPacketEid` | The packet's identifier. |
| Template | Cast | A reusable PDF template with tagged fields. |
| Template ID | `castEid` | The template's identifier. |
| Role (e.g. "Client", "Manager") | Signer `id` | A named signing slot; in Anvil an arbitrary signer id you map to fields. |
| Signer | Signer | A signing party (`name`, `email`). |
| `signature_id` (per signer) | Signer `eid` | Identifies one signer on a packet (used to generate their sign URL). |
| Merge field / custom field | Field alias + fill data | Values you inject; Anvil keys fill data by `aliasId`. |
| Template field | Field | A fillable/signable box, assigned to a signer via `fields[]`. |
| Embedded signing (`client_id` + `getSignUrl`) | Embedded signer + `generateEtchSignURL` | In-app signing; Anvil signer `signerType: 'embedded'`. |
| `hellosign-embedded` (`HelloSign.open`) | `@anvilco/anvil-embed-frame` (`AnvilEmbedFrame`) | The iframe UI for embedded signing. |
| Signing order | `routingOrder` | Sequential vs parallel (equal values sign in parallel). |
| Signing group | Signers sharing a `routingOrder` | Any of a set may sign at that step. |
| Bulk Send (`BulkSendJob`) | Loop `createEtchPacket` | Send one template to many recipients. |
| Unclaimed Draft | (no direct equivalent) | Use a Cast + `createEtchPacket`, or an embedded builder. |
| Test mode (`test_mode`) | `isTest` | Watermarked, non-billed test documents. |
| Event callback (`callback_url`, `event`) | Webhook action (`createWebhookAction`) | Event notifications. |
| `signature_request_signed` | `signerComplete` | A signer finished. |
| `signature_request_all_signed_and_complete` | `etchPacketComplete` | All signers done; documents downloadable. |
| Files download (`signatureRequest.files`) | `downloadDocuments` | Retrieve signed PDFs. |
| Completion certificate | Signing certificate | Audit trail; included in the download zip. |
| API key + `client_id` | `ANVIL_API_KEY` | Auth. One key per organization — no separate client ID for embedded signing. |
| API App + OAuth grant (act as another account) | Anvil OAuth app | Tenants authorize your app against their own Anvil org; you get a scoped token. Enterprise feature. |
| Tenant account (`account_id`) | Child organization | A parent org can own unlimited child orgs, each with its own templates, theme, users, webhook, and API keys. Enterprise feature. |
| Sending on behalf of another account | Child org's API key, or `replyToName`/`replyToEmail` | Full isolation vs. sender identity only. |
| API App `white_labeling_options` | Child org's CSS theme | Anvil brands per organization, not per app. |
| `metadata` | Your own database | Anvil packets have no metadata bag. |
