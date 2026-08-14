# PandaDoc → Anvil Terminology

A vocabulary map from PandaDoc's public API to Anvil. Use it to keep names straight
while reading the rest of the references. The full API mapping with before/after
code is in `api-mapping.md`; feature gaps are in `feature-parity.md`; template
migration (dynamic doc vs PDF) is in `template-migration.md`.

**Mental model in one line:** a PandaDoc *document* built from a *template* becomes
an Anvil *Etch packet* built from a *Cast* (or *dynamic doc*), where PandaDoc's
**roles** become signers, **fields** become signer-assigned field aliases, and
**tokens** become fill data — not signer fields.

| PandaDoc term | Anvil term | What it is |
|---------------|-----------|------------|
| Document | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| Document UUID (`id`) | `etchPacketEid` | The packet's identifier. |
| Template | Cast (or dynamic doc) | A reusable template. Addressed by `castEid`. |
| `template_uuid` | `castEid` | The template's identifier. |
| Role (`roles[].name`) | Signer `id` | A named signing slot bound to a recipient at create time. |
| Recipient | Signer | A signing party (bound to a role). |
| Field (`signature`, `text`, `date`, `checkbox`, …) | Field | A signable/fillable widget, assigned to a signer. |
| `field_id` / `merge_field` | Field alias (`aliasId`) | Your data key for a field. |
| **Token** (`{{Client.CompanyName}}`) | **Fill data** (`data.payloads`) | A body merge variable — **not** a signer field. |
| `fields{}` (prefill map) | Fill data (`data.payloads`) | Prefilled widget values. |
| `signing_order` | `routingOrder` | Signing order (equal values sign in parallel). |
| Signing session (`/documents/{id}/session`) | `generateEtchSignURL` | The embedded signing URL. |
| `send` `silent: false` / `silent: true` | `signerType: 'email'` / `'embedded'` | Anvil emails the signer vs you host the UI. |
| Content blocks / rich text | Dynamic-doc `content` nodes | Structured document body (dynamic-doc target). |
| Pricing table / line items | Repeating rows (dynamic doc) | Repeating structured content. |
| Webhook subscription | Webhook action (`createWebhookAction`) | Event delivery. |
| `document_state_changed` → `document.completed` | `etchPacketComplete` | All signers done; documents downloadable. |
| `recipient_completed` | `signerComplete` | One signer finished. |
| `download` / `download-protected` | `downloadDocuments` | Signed PDF (+ certificate) as a zip. |
| Sandbox key | `isTest` + dev key | Watermarked test documents. |
| `API-Key` header | `ANVIL_API_KEY` | Auth. One key for everything. |
| `metadata` / `tags` | Your own database | Anvil packets have no metadata bag. |
