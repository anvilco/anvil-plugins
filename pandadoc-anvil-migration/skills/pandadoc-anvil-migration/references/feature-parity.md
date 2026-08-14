# PandaDoc → Anvil Feature Parity Reference

PandaDoc features that don't map 1:1 to Anvil, with recommended workarounds. When
migrating, **always surface the relevant gaps to the developer** — never silently
drop a feature.

---

## Roles → Signer IDs

**PandaDoc:** Templates define named roles; recipients are bound to roles at
document-create time via `recipients[].role`.

**Anvil:** Signers with arbitrary IDs, explicitly mapped to fields via `fields[]`.

**Workaround:** Map each role name to a signer id (e.g. `Client` → `client`) and
assign that signer the fields whose `assigned_to.role` matched.

**Impact:** Low.

---

## Fields → Field Aliases

**PandaDoc:** On-page widgets (`signature`, `text`, `date`, `checkbox`,
`radio_buttons`, `dropdown`, …) assigned to a role.

**Anvil:** Fields with aliases, assigned to a signer. Types map directly (see
`api-mapping.md`).

**Workaround:** Map `field.field_id` / `merge_field` to an Anvil field alias.

**Impact:** Low.

---

## Tokens → Fill Data (not signer fields)

**PandaDoc:** `tokens[]` are `{{merge}}` variables in body text — no on-page
widget. Prefilled at create.

**Anvil:** Tokens have no widget equivalent on a PDF Cast. They become **fill data**
(`data.payloads`), keyed by an alias. On a dynamic doc, each token becomes an inline
`field` node whose `aliasId` is the token name.

**Workaround:** Treat tokens as data keys, not signer fields. If you migrate to a
**dynamic doc** (see below), a token maps cleanly to an inline field node.

**Impact:** Low-Medium — a conceptual remap.

---

## Block/Content Templates → Dynamic Docs (the big one)

**PandaDoc:** Templates are block/content-based (rich-text blocks + tokens +
fields). There is **no flat-PDF export** for a template.

**Anvil:** Two targets (see `template-migration.md`):
- **Dynamic doc** — a structured content tree with inline field nodes. Preserves
  headings, reflowing text, tables, and editability. The higher-fidelity match for
  PandaDoc's model.
- **PDF + Document AI** — render a base PDF and re-detect fields. Simpler and uses
  only the stable public API, but freezes layout.

**Workaround:** Choose per template — dynamic doc for content-heavy/editable/repeating
templates; PDF + Document AI for simple/fixed layouts or the least-maintenance path.

**Impact:** Medium — dynamic docs recover the structural fidelity a flat PDF loses,
at the cost of authoring against Anvil's internal content-tree format.

---

## Pricing Tables / Line Items → Repeating Rows

**PandaDoc:** Pricing tables and quote blocks with line items.

**Anvil:** A dynamic doc supports **repeating table rows** bound to an array data
key (e.g. `data.lineItems = [{…}, {…}]`). Pure pricing/quote *math* (totals, taxes)
is outside PDF-fill + e-sign scope.

**Workaround:** Migrate line-item tables as repeating rows on a dynamic doc. Handle
quote calculations in your application. **No signatures/interactive fields inside a
repeating row** — keep signature fields outside repeats.

**Impact:** Medium — repeating layout is supported; quote logic is not a signing
concern.

---

## Conditional Content → Clause Marks (partial)

**PandaDoc:** Show/hide blocks or sections based on rules.

**Anvil:** A dynamic doc supports conditional content via a `clause` **inline text
mark**, toggled by sending `data[clauseAlias] === false`. It's inline-text scoped,
not whole-block/section or per-row.

**Workaround:** Map inline conditional text to clause marks. For whole-section or
per-row conditionals, restructure — or decide the condition in your app and create
the packet with the right content/fields.

**Impact:** Medium — inline conditionals map; block/section conditionals only
partially.

---

## Async Create + Poll + Send → Single `createEtchPacket`

**PandaDoc:** Create a document (async, `document.uploaded`), poll until
`document.draft`, then `POST /send`.

**Anvil:** `createEtchPacket` creates and sends **synchronously** in one call.

**Workaround:** Delete the poll loop. One call replaces create → poll → send.

**Impact:** None — a simplification.

---

## Signing Order → `routingOrder`

**PandaDoc:** `signing_order` per recipient (order N+1 after all N complete; equal =
parallel).

**Anvil:** `routingOrder` — identical semantics.

**Impact:** None — direct equivalent.

---

## Embedded Session → `AnvilEmbedFrame`

**PandaDoc:** Send `silent: true`, create a signing **session**, embed
`app.pandadoc.com/s/{id}`.

**Anvil:** `signerType: 'embedded'`, `generateEtchSignURL`, `AnvilEmbedFrame`.

**Workaround:** Direct mapping (see `api-mapping.md`). Allowlist your domains in the
Anvil dashboard.

**Impact:** None — functionally equivalent.

---

## Completion Webhooks → `etchPacketComplete`

**PandaDoc:** No single `document_completed` trigger — completion is
`document_state_changed` with `status == "document.completed"`, and/or
`document_completed_pdf_ready`.

**Anvil:** `etchPacketComplete` (all signers done) and `signerComplete` (per signer).

**Workaround:** Map both PandaDoc completion signals onto `etchPacketComplete`; use
`document_completed_pdf_ready` as the download trigger equivalent.

**Impact:** Low.

---

## File Collection (`collect_file`) → Signer Attachment

**PandaDoc:** A `collect_file` field lets a signer upload a file.

**Anvil:** Signer attachment fields exist but behave differently.

**Workaround:** Map `collect_file` to an Anvil signer attachment where supported, or
collect the file in your application flow.

**Impact:** Low-Medium.

---

## Sandbox vs Production Key → `isTest`

**PandaDoc:** A separate sandbox API key produces watermarked, non-binding
documents.

**Anvil:** Use `isTest: true` on individual packets (watermarked, doesn't count
against your plan) with a development API key.

**Workaround:** Replace sandbox-key usage with `isTest` during development.

**Impact:** None — a config change.

---

## OAuth Multi-Tenant → Separate Orgs or API Keys

**PandaDoc:** OAuth2 lets your app act on behalf of other PandaDoc accounts.

**Anvil:** No OAuth-on-behalf. Each org has its own API key.

**Workaround:** Single org with template separation, or separate orgs per tenant
(keys stored encrypted), or Anvil's reseller/white-label program.

**Impact:** High — an architectural decision. Discuss with the developer first.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Roles → signers | Equivalent | Low |
| Fields → aliases | Equivalent | Low |
| Tokens → fill data | Remap (not signer fields) | Low-Medium |
| Block/content templates | Dynamic doc (higher fidelity) or PDF+AI | Medium |
| Pricing / line-item tables | Repeating rows (no sigs inside) | Medium |
| Conditional content | Clause marks (inline only) | Medium |
| Async create+poll+send | Single `createEtchPacket` | None (simpler) |
| Signing order | Direct (`routingOrder`) | None |
| Embedded session | Direct (`AnvilEmbedFrame`) | None |
| Completion webhooks | `etchPacketComplete` | Low |
| File collection | Signer attachment / app flow | Low-Medium |
| Sandbox vs prod key | `isTest` | None |
| OAuth multi-tenant | Separate orgs / keys | High |
