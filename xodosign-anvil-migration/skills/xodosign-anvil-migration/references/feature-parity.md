# Apryse Xodo Sign (eversign) → Anvil Feature Parity Reference

Apryse Xodo Sign / eversign features that don't map 1:1 to Anvil, with recommended
workarounds. When
migrating, **always surface the relevant gaps to the developer** — never silently
drop a feature.

---

## Signer Roles → Signer IDs Mapped to Fields

**eversign:** Templates define named roles (e.g. "Client", "Manager"). You fill a
role at send time by passing a signer with that `role`; every field tagged for the
role goes to that signer.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary
IDs, and you explicitly map each signer to the fields they own via `fields[]` in
`createEtchPacket`.

**Workaround:** Create a role → signer-ID mapping (e.g. role `Client` → signer id
`client`), then list the fields each signer owns. More explicit, but a one-time
setup per template.

**Impact:** Low.

---

## Merge Fields / Field Values → Data Payloads

**eversign:** Prefilled data comes from template **merge fields**
(`{identifier, value}`) or a positioned field's `value`.

**Anvil:** Data is passed via `data.payloads.{fileId}.data`, keyed by field alias.

**Workaround:** During template upload, alias each Anvil field to the eversign
field `identifier`. Then key your payload by those aliases — the values move over
unchanged, only the structure wrapper differs.

**Impact:** Low.

---

## Recipients (CC) → Non-Signing Recipients

**eversign:** `recipients` are CC parties who receive the completed document without
signing (`name` + `email`, optionally a template `role`).

**Anvil:** The template migration carries **signers only** — CC recipients are not
carried over.

**Workaround:** Re-add them at packet-creation time. Either:
1. Add them as Anvil signers with no signature fields (so they get the completion
   email), or
2. Handle delivery in your app on `etchPacketComplete` — download the documents and
   notify the CC parties yourself.

**Impact:** Low-Medium — a one-time decision per template.

---

## Signing Order → Anvil `routingOrder`

**eversign:** `use_signer_order: true` plus a per-signer `order` integer enforces a
sequential signing order.

**Anvil:** `routingOrder` integer per signer. Lower signs first; **equal values sign
in parallel** (an Anvil nicety eversign's strict ordering doesn't have).

**Workaround:** Direct mapping — set `routingOrder` from `order`. Drop
`use_signer_order` (routing order is always honored when set).

**Impact:** None — direct equivalent.

---

## Embedded Signing → `AnvilEmbedFrame`

**eversign:** Set `embedded_signing` on the document; the created document's signers
carry an `embedded_signing_url` you iframe. Optionally `deliver_email` also emails
the signer.

**Anvil:** Set `signerType: 'embedded'`, call `generateEtchSignURL`, embed with
`AnvilEmbedFrame`, handle the `signerComplete` event.

**Workaround:** Direct mapping (see `api-mapping.md`). Remember to allowlist your
domains in the Anvil dashboard.

**Impact:** None — functionally equivalent.

---

## Decline to Sign → App-Level Decline Flow

**eversign:** Built-in "Decline" action in the signing UI; fires the
`document_declined` event and honors `redirect_decline`.

**Anvil:** No built-in decline button.

**Workaround:** Add a "Decline" button alongside the embedded signing frame. On
click, record the decline in your database, optionally void the packet, and notify
the other parties — the same handling you had for the `document_declined` event.

**Impact:** Low-Medium — a straightforward UI addition with custom state.

---

## Expiration & Auto-Reminders → App-Level Scheduling

**eversign:** `expires` (a document expiration timestamp) and `reminders` (automatic
reminder emails) are set on the document. `send_reminder` also triggers a manual
reminder for one signer.

**Anvil:** Etch sign URLs have a TTL, but the packet itself doesn't expire, and Anvil
doesn't schedule reminder emails from these settings.

**Workaround:**
1. **Expiration** — track a deadline in your database; after it passes, stop
   generating sign URLs and mark the packet expired (optionally void it).
2. **Reminders** — schedule reminder emails from your app, or trigger a fresh Anvil
   signing email when you need to nudge a signer.

**Impact:** Low-Medium — app-level scheduling if hard deadlines/reminders matter.

---

## Cancelling a Document → App-Level / Packet Void

**eversign:** `cancelDocument` (or `DELETE /document?...&cancel=1`) cancels a sent
document; drafts and cancelled documents can then be deleted.

**Anvil:** Packets can be voided, but the reason/notification flow differs.

**Workaround:** Void the Anvil packet and manage the reason + notifications in your
application. Track cancelled/voided state in your own database.

**Impact:** Low.

---

## Bulk Sending → Loop with Rate Limiting

**eversign:** No dedicated bulk-send API — you loop `createDocumentFromTemplate` per
recipient today.

**Anvil:** Also no built-in bulk send API.

**Workaround:** Loop over `createEtchPacket` with rate limiting. Production keys
support 40 requests/second; the Anvil Node client handles rate limiting and retries
automatically.

```typescript
async function bulkSend(
  recipients: Array<{ name: string; email: string; data: Record<string, any> }>,
  castEid: string
) {
  const results = []
  for (const r of recipients) {
    const { data, errors } = await anvilClient.createEtchPacket({
      variables: {
        name: `Packet for ${r.name}`,
        isDraft: false,
        signers: [{
          id: 'signer', name: r.name, email: r.email, signerType: 'email',
          fields: [{ fileId: 'doc', fieldId: 'signature' }],
        }],
        files: [{ id: 'doc', castEid }],
        data: { payloads: { doc: { data: r.data } } },
      },
    })
    results.push({ email: r.email, eid: data?.data?.createEtchPacket?.eid, errors })
  }
  return results
}
```

**Impact:** Medium — a loop instead of a batch call, but the client handles rate
limiting.

---

## Signer Authentication (PIN / SMS) → Custom Auth Wall

**eversign:** Per-signer authentication — a `pin` code, or SMS authentication
(`signer_authentication_sms_enabled` + `signer_authentication_phone_number`) before
signing.

**Anvil:** No built-in signer authentication of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL:
1. Verify a PIN or SMS/OTP via your existing provider (Twilio, etc.).
2. Use your app's existing MFA as a gate before signing.
3. For embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## OAuth / Multiple Businesses → Separate Orgs or API Keys

**eversign:** One account can hold multiple **businesses** (selected per request via
`business_id`), and OAuth lets your app act on behalf of other eversign accounts
(multi-tenant SaaS).

**Anvil:** No `business_id` and no OAuth-on-behalf. Each Anvil organization has its
own API key.

**Workaround:**
1. **Single org with template separation** — one Anvil account; track which
   templates/tenants own what in your database.
2. **Separate orgs per business/tenant** — each gets its own Anvil org and API key
   (stored encrypted), for full isolation. This is the natural landing spot for
   each eversign `business_id`.
3. **Anvil reseller/white-label program** — contact Anvil for multi-tenant SaaS use
   cases.

**Impact:** High — an architectural decision. Discuss with the developer first.

---

## White Labeling → Anvil CSS Themes

**eversign:** Branding via business settings (logo, colors) and custom completion
redirect URLs.

**Anvil:** CSS-based theming of the signing UI — more control than dashboard
branding.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes) and
configure it in the Anvil dashboard under API settings > white labeling.

**Impact:** Low — more powerful, but requires a CSS file.

---

## Document Metadata (`meta`) → Your Own Database

**eversign:** Documents carry a `meta` key-value bag for your own reference data,
and a `client` string for an internal reference.

**Anvil:** Etch packets have **no metadata bag**.

**Workaround:** Store the metadata in your own database, keyed by `etchPacketEid`.
This is where the EID-storage table from the `anvil-document-sdk` skill earns its
keep — every packet you create should have a row that carries what used to live in
eversign `meta`.

**Impact:** Low-Medium — a schema addition, not lost data.

---

## "Require All Signers" → Implicit in Anvil

**eversign:** `require_all_signers` controls whether every signer must sign for the
document to complete.

**Anvil:** A packet completes when its assigned signers finish; there's no separate
"any vs. all" toggle. If you relied on partial completion, model that in your app.

**Impact:** Low — confirm whether the flag carried real behavior.

---

## Reflowing Layout / Content Templates → Dynamic Docs (optional)

**eversign:** A template is a fixed PDF with positioned fields. Content doesn't
reflow, and there's no native "repeat this row per line item" concept.

**Anvil:** Beyond the PDF converter (the default, which preserves the exact PDF),
Anvil also has **dynamic documents** — structured content templates with reflowing
text, real tables, and **repeating table rows** bound to array data. See
`template-migration.md` (and the `pandadoc-anvil-migration` plugin) for the
dynamic-doc authoring flow (create → `updateCast` content tree → publish).

**When to consider it:** only if an eversign template would benefit from reflowing
content or repeating line-item tables that a fixed PDF can't provide. For a straight
migration, **use the PDF path** — it preserves the exact layout and field placement.
Dynamic docs are a *rebuild*, not a conversion.

**Not a fix for:** reminders/expiration (those are packet concerns, unrelated to
document format). Signatures can't live inside a repeating row.

**Impact:** Optional — a fidelity upgrade for specific templates, not the default.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Signer roles → fields | Equivalent (explicit field mapping) | Low |
| Merge fields / field values | Equivalent (different structure) | Low |
| Recipients (CC) | Non-signing recipients / app-level | Low-Medium |
| Signing order | Direct (`routingOrder`) | None |
| Embedded signing | Direct (`AnvilEmbedFrame`) | None |
| Decline to sign | App-level UI + state | Low-Medium |
| Expiration & reminders | App-level scheduling | Low-Medium |
| Cancel / void | App-level / packet void | Low |
| Bulk send | Loop with rate limiting | Medium |
| Signer auth (PIN / SMS) | Custom auth wall | Medium-High |
| OAuth / multiple businesses | Separate orgs / keys | High |
| White labeling | CSS themes (more powerful) | Low |
| Document `meta` | Your own database | Low-Medium |
| Require all signers | Implicit in Anvil | Low |
