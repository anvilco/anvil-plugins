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

## Bulk Send → Loop with Rate Limiting

**PandaDoc:** Create many documents from one template programmatically; the API
enforces per-endpoint rate limits (HTTP 429 when exceeded).

**Anvil:** No dedicated bulk-send API.

**Workaround:** Loop over `createEtchPacket`. Production keys support 40
requests/second; the Anvil Node client handles rate limiting and retries
automatically, so a straightforward loop is safe.

```typescript
for (const r of recipients) {
  await anvilClient.createEtchPacket({ variables: { /* per-recipient packet */ } })
}
```

**Impact:** Medium — a loop instead of a batch, but rate limiting is handled for you.

---

## Document Metadata → Your Own Database

**PandaDoc:** `metadata` (and `tags`) on a document carry arbitrary key/values that
travel with the document and come back on webhooks.

**Anvil:** Etch packets have **no metadata bag**.

**Workaround:** Store the metadata in your own database keyed by `etchPacketEid`.
You already receive the packet EID on webhooks, so join to your own record there.

**Impact:** Low — a small storage change; you likely track this data already.

---

## Signer Verification (SMS / Passcode) → Custom Auth Wall

**PandaDoc:** Recipient `verification_settings` (SMS or passcode) gate a signer
before they can open the document.

**Anvil:** No built-in signer verification of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL — verify a
passcode or SMS/OTP via your existing provider, or reuse your app's MFA. For
embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## White Labeling → Anvil CSS Themes

**PandaDoc:** Branding via workspace settings (logo, colors).

**Anvil:** CSS-based theming of the signing UI — more control than PandaDoc's
branding.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes)
and configure it in the Anvil dashboard under API settings > white labeling.

**Impact:** Low — more powerful, but requires a CSS file.

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
| Bulk send | Loop with rate limiting | Medium |
| Document metadata | Store in your own DB | Low |
| Signer verification (SMS/passcode) | Custom auth wall | Medium-High |
| White labeling | CSS themes (more powerful) | Low |
| Sandbox vs prod key | `isTest` | None |
| OAuth multi-tenant | Separate orgs / keys | High |
