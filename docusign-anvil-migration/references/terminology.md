# DocuSign → Anvil Terminology

A vocabulary map from DocuSign's eSignature REST API to Anvil. Use it to keep names
straight while reading the rest of the references. The full API mapping with
before/after code is in `api-mapping.md`; feature gaps are in `feature-parity.md`;
template conversion is in `template-migration.md`.

**Mental model in one line:** a DocuSign *envelope* built from a *template* becomes
an Anvil *Etch packet* built from a *Cast*, and DocuSign's roles, tabs, captive
recipients, and Connect events become Anvil signer IDs, fields, embedded signers,
and webhook actions.

| DocuSign term | Anvil term | What it is |
|---------------|-----------|------------|
| Envelope | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| `envelopeId` | `etchPacketEid` | The packet's identifier. |
| Template (`envelopeTemplate`) | Cast | A reusable PDF template with tabs. |
| `templateId` | `castEid` | The template's identifier. |
| Template role (`roleName`) | Signer `id` | A named signing slot; in Anvil an arbitrary signer id you map to fields. |
| Recipient / Signer | Signer | A signing party. |
| `recipientId` | Signer `eid` (per packet) | Identifies a recipient/signer on the packet. |
| Tab (`signHere`, `text`, `date`, …) | Field | A signable/fillable box; each has a type. |
| `tabLabel` / `tabId` | Field alias (`aliasId`) | Your data key for a field. |
| Tab `value` / `prefillTabs` | Fill data (`data.payloads`) | Prefilled field values. |
| `routingOrder` | `routingOrder` | Signing order (equal values sign in parallel). |
| `clientUserId` (captive recipient) | Embedded signer (`signerType: 'embedded'`) | In-app signing (no email sent). |
| Recipient view (`createRecipientView`) | `generateEtchSignURL` | The embedded signing URL. |
| Carbon copy (`carbonCopies`) | Non-signing recipient / app-level | Receives completed documents; doesn't sign. |
| Connect / `eventNotification` | Webhook action (`createWebhookAction`) | Event delivery. |
| `envelope-completed` | `etchPacketComplete` | All signers done; documents downloadable. |
| `recipient-completed` | `signerComplete` | One signer finished. |
| Documents `combined` / `certificate` | `downloadDocuments` | Signed PDFs + signing certificate (one zip). |
| `status: "sent"` / `"created"` | send (default) / `isDraft: true` | Send immediately vs save as a draft. |
| Demo vs production account | `isTest` + dev key | Watermarked test packets vs live. |
| Integration key + JWT + `accountId`/`base_uri` | `ANVIL_API_KEY` | Auth. One key per organization; single-tenant integrations need no impersonation or account discovery. |
| Auth Code grant (act as another account) | Anvil OAuth app | Tenants authorize your app against their own Anvil org; you get a scoped token. Enterprise feature. |
| Account under your integration (per-tenant `accountId`) | Child organization | A parent org can own unlimited child orgs, each with its own templates, theme, users, webhook, and API keys. Enterprise feature. |
| SOBO (`X-DocuSign-Act-As-User`) | Child org's API key, or `replyToName`/`replyToEmail` | Full isolation vs. sender identity only. |
| `brandId` on an envelope | Child org's CSS theme | Anvil brands per organization, not per envelope. |
| `customFields` | Your own database | Anvil packets have no metadata bag. |
