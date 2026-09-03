# Apryse Xodo Sign (eversign) → Anvil Terminology

A vocabulary map from Apryse Xodo Sign — the product formerly (and still, at the API
level) called **eversign** — to Anvil. Use it to keep names straight while reading
the rest of the references. The full API mapping with before/after code is in
`api-mapping.md`; feature gaps are in `feature-parity.md`; template conversion is in
`template-migration.md`.

**Heritage:** "Apryse Xodo Sign", "Xodo Sign", and "eversign" are the same
platform — eversign was rebranded Xodo Sign and is now part of Apryse. The REST API
is `api.eversign.com`, the SDK/package is `eversign`, and auth is still
`access_key` + `business_id`. Every eversign term below is what a current
integration actually uses.

**Mental model in one line:** an eversign *document* built from a *template*
becomes an Anvil *Etch packet* built from a *Cast*, and eversign's signer roles,
positioned form fields, merge fields, embedded signing, and log/webhook events
become Anvil signer IDs, field aliases, embedded signers, and webhook actions.

| Xodo Sign / eversign term | Anvil term | What it is |
|---------------------------|-----------|------------|
| Document | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| `document_hash` | `etchPacketEid` | The document/packet identifier. |
| Template (`is_template` document) | Cast | A reusable PDF template with positioned fields. |
| `template_id` | `castEid` | The template's identifier (used to instantiate a document). |
| Signer role (`role`) | Signer `id` | A named signing slot on a template; in Anvil an arbitrary signer id you map to fields. |
| Signer | Signer | A signing party (`name`, `email`). |
| Signer `id` (per document) | Signer `eid` (per packet) | Identifies a signer on the packet (used to generate their sign URL). |
| Form field (`signature`, `text`, `date_signed`, …) | Field | A positioned signable/fillable box; each has a type and x/y/page. |
| Field `identifier` | Field alias (`aliasId`) | Your data key for a field. |
| Field `value` / template merge field (`{identifier, value}`) | Fill data (`data.payloads`) | Prefilled field values. |
| `order` + `use_signer_order` | `routingOrder` | Signing order (equal values sign in parallel in Anvil). |
| `embedded_signing` + `embedded_signing_url` | Embedded signer (`signerType: 'embedded'`) + `generateEtchSignURL` | In-app signing (no email sent). |
| Recipient (CC) | Non-signing recipient / app-level | Receives completed documents; doesn't sign. |
| Webhook / log event | Webhook action (`createWebhookAction`) | Event delivery. |
| `document_completed` | `etchPacketComplete` | All signers done; documents downloadable. |
| `document_signed` | `signerComplete` | One signer finished. |
| `download_final_document` (+ `audit_trail`) / `download_raw_document` | `downloadDocuments` | Signed PDFs + signing certificate (one zip). |
| `is_draft` | `isDraft` | Save as a draft vs. send immediately. |
| `sandbox` | `isTest` + dev key | Watermarked, non-billed test documents. |
| `access_key` + `business_id` | `ANVIL_API_KEY` | Auth. One key per organization; single-tenant integrations need no business selection. |
| OAuth on-behalf (act as another account) | Anvil OAuth app | Tenants authorize your app against their own Anvil org; you get a scoped token. Enterprise feature. |
| Business / tenant account | Child organization | A parent org can own unlimited child orgs, each with its own templates, theme, users, webhook, and API keys. Enterprise feature. |
| Sending as another business | Child org's API key, or `replyToName`/`replyToEmail` | Full isolation vs. sender identity only. |
| Business branding | Child org's CSS theme | Anvil brands per organization, not per business. |
| Signer `pin` / SMS authentication | Signer auth (app-level) | Extra verification before signing. |
| `meta` | Your own database | Anvil packets have no metadata bag. |
