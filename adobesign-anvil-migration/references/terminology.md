# Adobe Acrobat Sign → Anvil Terminology

A vocabulary map from Adobe Sign's eSign REST API (v6) to Anvil. Use it to keep
names straight while reading the rest of the references. The full API mapping with
before/after code is in `api-mapping.md`; feature gaps are in `feature-parity.md`;
template conversion is in `template-migration.md`.

**Mental model in one line:** an Adobe *agreement* built from a *library document*
becomes an Anvil *Etch packet* built from a *Cast*, and Adobe's participant sets,
form fields, merge fields, signing URLs, and webhook events become Anvil signer IDs,
field aliases, prefill data, embedded sign URLs, and webhook actions.

| Adobe Sign term | Anvil term | What it is |
|-----------------|-----------|------------|
| Agreement | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| `agreementId` | `etchPacketEid` | The packet's identifier. |
| Library document (template) | Cast | A reusable PDF template with form fields. |
| `libraryDocumentId` | `castEid` | The template's identifier. |
| Transient document (`POST /transientDocuments`) | Uploaded file (`createCast` upload) | A file uploaded for one-time use; `transientDocumentId` is valid 7 days. |
| `fileInfos[]` | `files[]` | The documents in the transaction (`{ castEid }` in Anvil). |
| Participant set (`participantSetsInfo[]`) | Signer(s) | A recipient slot at one routing step; its members are alternates. |
| `memberInfos[].email` | `signers[].email` | A recipient's email. |
| Participant `role` (`SIGNER`, `APPROVER`, …) | Signer `id` / non-signing recipient | The kind of participant; in Anvil an arbitrary signer id mapped to fields. |
| `order` (on a participant set) | `routingOrder` | Signing order. Adobe: sequential across sets. |
| Form field | Field | A fillable/signable box on the PDF; each has a type. |
| Field name (form field / merge field) | Field alias (`aliasId`) | Your data key for a field. |
| `mergeFieldInfo[]` (`{ fieldName, defaultValue }`) | Fill data (`data.payloads`) | Prefilled field values keyed by alias. |
| `signatureType` (`ESIGN` / `WRITTEN`) | (e-sign is the default) | Electronic vs wet-ink signing. |
| `state` (`IN_PROCESS` / `DRAFT` / `AUTHORING`) | send (default) / `isDraft: true` | Send immediately vs save as a draft. |
| Signing URL (`signingUrlSetInfos[].signingUrls[].esignUrl`) | `generateEtchSignURL` | The embedded signing URL. |
| Embedded signing (fetch signing URL + suppress emails) | Embedded signer (`signerType: 'embedded'`) | In-app signing (no email sent). |
| CC (`ccs[]`) | Non-signing recipient / app-level | Receives the completed documents; doesn't sign. |
| Webhook (`POST /webhooks`, `webhookSubscriptionEvents`) | Webhook action (`createWebhookAction`) | Event delivery. |
| `AGREEMENT_ACTION_COMPLETED` | `signerComplete` | One participant finished. |
| `AGREEMENT_WORKFLOW_COMPLETED` | `etchPacketComplete` | All participants done; documents downloadable. |
| `combinedDocument` + `auditTrail` | `downloadDocuments` | Signed PDF(s) + signing certificate (one zip in Anvil). |
| Web form (widget, `POST /widgets`) | (no direct equivalent — Anvil Workflows / embedded) | A hosted, reusable public signing form. |
| OAuth2 / Integration Key + `GET /baseUris` + `x-api-user` | `ANVIL_API_KEY` | Auth. One key per organization; single-tenant integrations need no shard discovery or impersonation. |
| OAuth on-behalf (act as another account) | Anvil OAuth app | Tenants authorize your app against their own Anvil org; you get a scoped token. Enterprise feature. |
| Tenant account / group (`groupId`) | Child organization | A parent org can own unlimited child orgs, each with its own templates, theme, users, webhook, and API keys. Enterprise feature. |
| `x-api-user` / `x-on-behalf-of-user` | Child org's API key, or `replyToName`/`replyToEmail` | Full isolation vs. sender identity only. |
| Account-level branding | Child org's CSS theme | Anvil brands per organization. |
| Custom fields / external ID metadata | Your own database | Anvil packets have no metadata bag. |
