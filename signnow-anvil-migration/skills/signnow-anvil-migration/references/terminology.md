# signNow → Anvil Terminology

A vocabulary map from signNow's (airSlate SignNow's) REST API to Anvil. Use it to
keep names straight while reading the rest of the references. The full API mapping
with before/after code is in `api-mapping.md`; feature gaps are in
`feature-parity.md`; template migration is in `template-migration.md`.

**Mental model in one line:** a signNow *document* built from a *template* becomes
an Anvil *Etch packet* built from a *Cast*, and signNow's roles, coordinate
*fields*, field *invites*, embedded invites, and event subscriptions become Anvil
signer IDs, field aliases, signers, embedded signers, and webhook actions.

| signNow term | Anvil term | What it is |
|--------------|-----------|------------|
| Document | Etch packet | The signing transaction. `createEtchPacket` returns an `etchPacketEid`. |
| Document `id` | `etchPacketEid` | The packet's identifier. |
| Template | Cast | A reusable PDF with positioned fields. `POST /template/{id}/copy` spawns a document from it. |
| Template `id` | `castEid` | The template's identifier. |
| Role (e.g. "Signer 1", "Recipient 2") | Signer `id` | A named signing slot on the document's fields; in Anvil an arbitrary signer id you map to fields. |
| Signer / recipient (`to[]`) | Signer | A signing party (`email`, `role`). |
| Field / element (`signature`, `text`, `checkbox`, `radiobutton`, `dropdown`, …) | Field | A positioned box with `x`/`y`/`page_number`/`width`/`height`, assigned to a role. |
| Field `field_name` / `label` | Field alias (`aliasId`) | Your data key for a field. |
| Prefill (`PUT /v2/documents/{id}/prefill-texts`) | Fill data (`data.payloads`) | Prefilled field values. |
| Field invite (role-based, `POST /document/{id}/invite`) | `createEtchPacket` signers + `fields[]` | Sends the document to role-mapped signers. |
| Freeform invite | Email signer with a signature field | Ad-hoc invite, no pre-placed role fields. |
| Invite `order` | `routingOrder` | Signing order (equal values sign in parallel). |
| Embedded invite (`POST /v2/documents/{id}/embedded-invites`) + `/link` | Embedded signer (`signerType: 'embedded'`) + `generateEtchSignURL` | In-app signing (no email sent). |
| `cc[]` | Non-signing recipient / app-level | Receives the completed document; doesn't sign. |
| Event subscription (`POST /api/v2/events`) | Webhook action (`createWebhookAction`) | Event delivery. |
| `document.complete` | `etchPacketComplete` | All recipients signed; documents downloadable. |
| `document.update` / `invite.update` | `signerComplete` | Signer-level progress (closest analog — see `api-mapping.md`). |
| Download (`GET /document/{id}/download?type=collapsed`) | `downloadDocuments` | The flattened signed PDF. |
| Signing history / audit trail (separate download) | Signing certificate | Audit trail; Anvil bundles it into the download zip. |
| OAuth2 Bearer token (Basic client credential → `POST /oauth2/token`) | `ANVIL_API_KEY` | Auth. One key; no token exchange, no client id/secret. |
| Eval host (`api.eval-signnow.com`) | `isTest: true` + dev key | Watermarked, non-billed test packets. |
| (no per-document metadata bag) | Your own database | Anvil packets have no metadata bag either — store source metadata yourself. |
