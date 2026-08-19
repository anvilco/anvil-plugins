# BoldSign → Anvil Terminology

A vocabulary map from BoldSign's e-signature REST API to Anvil. Use it to keep
names straight while reading the rest of the references. The full API mapping with
before/after code is in `api-mapping.md`; feature gaps are in `feature-parity.md`;
template migration is in `template-migration.md`.

**Mental model in one line:** a BoldSign *document* sent from a *template* becomes
an Anvil *Etch packet* built from a *Cast*, and BoldSign's roles, positioned form
fields, embedded sign links, and webhook events become Anvil signer IDs, field
aliases, embedded signers, and webhook actions.

| BoldSign term | Anvil term | What it is |
|---------------|-----------|------------|
| Document (signature request) | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| `documentId` | `etchPacketEid` | The document/packet identifier. |
| Template | Cast | A reusable PDF with positioned form fields. |
| `templateId` | `castEid` | The template's identifier. |
| Role (`roleIndex` / `signerRole`) | Signer `id` | A named signing slot on a template; in Anvil an arbitrary signer id you map to fields. |
| Signer (`name`, `emailAddress`) | Signer | A signing party. |
| `signerType` (`Signer` / `InPersonSigner`) | `signerType` (`email` / `embedded`) | How the signer signs — via BoldSign email vs in-app. |
| Form field (`fieldType` + `bounds`) | Field | A signable/fillable box; BoldSign positions it by `bounds` {x, y, width, height} + `pageNumber`. |
| Form field `id` / `name` | Field alias (`aliasId`) | Your data key for a field. |
| Form field `value` / `existingFormFields` | Fill data (`data.payloads`) | Prefilled field values. |
| `signerOrder` (+ `enableSigningOrder`) | `routingOrder` | Signing order (equal values sign in parallel). |
| CC recipient (`cc[]`) | Non-signing recipient / app-level | Receives the completed document; doesn't sign. |
| Embedded sign link (`getEmbeddedSignLink` → `signLink`) | `generateEtchSignURL` | The per-signer embedded signing URL. |
| Embedded request URL (`createEmbeddedRequestUrl`) | Embedded packet builder | In-app *sender* UI to prepare + send — a different surface from the sign URL. |
| Webhook event (`X-BoldSign-Signature`) | Webhook action (`createWebhookAction`) | Event delivery. |
| `Signed` event | `signerComplete` | One signer finished. |
| `Completed` event | `etchPacketComplete` | All signers done; documents downloadable. |
| Download (`/document/download`) + `downloadAuditLog` | `downloadDocuments` | Signed PDF + audit-trail certificate (Anvil returns both in one zip). |
| Sandbox mode (sandbox key) | `isTest` + dev key | Watermarked, non-billed test documents. |
| `X-API-KEY` / OAuth Bearer token | `ANVIL_API_KEY` | Auth. One key; no OAuth handshake or account discovery. |
| `labels` / metadata | Your own database | Anvil packets have no metadata bag. |
