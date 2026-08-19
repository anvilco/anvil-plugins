# Adobe Acrobat Sign → Anvil Feature Parity Reference

Adobe Sign features that don't map 1:1 to Anvil, with recommended workarounds. When
migrating, **always surface the relevant gaps to the developer** — never silently
drop a feature.

---

## Participant Roles → Signer IDs Mapped to Fields

**Adobe Sign:** `participantSetsInfo[]` groups recipients into sets, each with a
`role` (`SIGNER`, `APPROVER`, `ACCEPTOR`, `FORM_FILLER`, `CERTIFIED_RECIPIENT`,
`DELEGATE_TO_*`). Fields on the document are assigned to a participant.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary
IDs, and you explicitly map each signer to the fields they own via `fields[]` in
`createEtchPacket`. **Every signer must own ≥1 field.**

**Workaround:** Map each role to a signer ID (`SIGNER` → `signer`, `APPROVER` →
`approver`). Assign each their fields. For roles that don't normally sign
(`APPROVER`, `FORM_FILLER`, `CERTIFIED_RECIPIENT`), give them at least one field
(e.g. a date, an initial, or a text field) or model them app-level (next entry) —
otherwise the packet errors.

**Impact:** Low-Medium — a per-template naming + field-assignment exercise.

---

## Alternate Members in a Participant Set → Parallel Signers (semantics differ)

**Adobe Sign:** A participant set can contain **multiple `memberInfos`** at the same
`order`. Those members are **alternates** — *any one* of them may act for the set
(a "signing group").

**Anvil:** Signers sharing a `routingOrder` sign in **parallel** — *all* of them
act. There is no "any one of these may sign" primitive.

**Workaround:** Confirm what each multi-member set means. If it's genuinely
"any one of a group," pick the real signer at send time in your app (resolve the
group to one email before `createEtchPacket`), or add them as parallel signers and
cancel the rest once one completes.

**Impact:** Medium — only where multi-member sets are actually used; easy to miss
because the shapes look similar.

---

## Merge Fields → Data Payloads

**Adobe Sign:** Prefilled data is supplied as `mergeFieldInfo[]` —
`{ fieldName, defaultValue }` pairs matched to form fields by name.

**Anvil:** Data is passed via `data.payloads.{fileId}.data`, keyed by field alias.

**Workaround:** Tag Anvil fields with aliases matching your Adobe `fieldName`s (or
re-alias to your own names), then move each `{ fieldName, defaultValue }` into the
payload object. Structurally different, semantically identical.

**Impact:** Low — a structural change in the API call.

---

## CC / Certified Recipients → Non-Signing Recipients

**Adobe Sign:** `ccs[]` and the `CERTIFIED_RECIPIENT` role receive the completed
documents (or must acknowledge) without signing.

**Anvil:** No CC primitive on a packet.

**Workaround:**
1. Add them as Anvil signers with no signature fields (if your org allows
   non-signing signers), so they get the completion email; or
2. Handle delivery in your application on `etchPacketComplete` — download the
   documents and email/notify the CC parties yourself.

**Impact:** Low-Medium — a one-time decision per template.

---

## Signing Order → Anvil `routingOrder`

**Adobe Sign:** `order` (integer) on each participant set. Lower acts first.

**Anvil:** `routingOrder` (integer) on each signer. Identical semantics — lower
first, equal = parallel.

**Workaround:** Direct mapping.

**Impact:** None — direct equivalent (but see "alternate members" above for the
within-set nuance).

---

## Embedded Signing → `AnvilEmbedFrame`

**Adobe Sign:** Suppress signer emails (`emailOption`), then
`GET /agreements/{id}/signingUrls` and iframe the `esignUrl`.

**Anvil:** Set `signerType: 'embedded'`, call `generateEtchSignURL`, embed with
`AnvilEmbedFrame`, handle `signerComplete`.

**Workaround:** Direct mapping (see `api-mapping.md`). Anvil's `signerType` folds
Adobe's two concerns (email suppression + URL fetch) into one switch. Remember to
allowlist your domains in the Anvil dashboard.

**Impact:** None — functionally equivalent.

---

## Reject / Decline to Sign → App-Level Decline Flow

**Adobe Sign:** Built-in "Decline to sign" action; fires the `AGREEMENT_REJECTED`
webhook.

**Anvil:** No built-in decline button.

**Workaround:** Add a "Decline" button alongside the embedded signing frame. On
click, record the decline in your database, optionally void the packet, and notify
the other parties — the same handling you had for the rejected event.

**Impact:** Low-Medium — a straightforward UI addition with custom state.

---

## Expiration & Reminders → App-Level Scheduling

**Adobe Sign:** `expirationTime` on an agreement, and reminder schedules
(`POST /agreements/{id}/reminders`, or account reminder settings).

**Anvil:** Etch sign URLs have a TTL, but the packet itself doesn't expire, and
Anvil doesn't schedule reminder emails from template settings.

**Workaround:**
1. **Expiration** — track a deadline in your database; after it passes, stop
   generating sign URLs and mark the packet expired (optionally void it).
2. **Reminders** — schedule reminder emails from your app, or trigger a fresh Anvil
   signing email when you need to nudge a signer.

**Impact:** Low-Medium — app-level scheduling if hard deadlines/reminders matter.

---

## Bulk Send ("Send in Bulk" / MegaSign) → Loop with Rate Limiting

**Adobe Sign:** Send one template to many recipients in a single bulk operation
(MegaSign / "Send in Bulk").

**Anvil:** No built-in bulk send API.

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

## Signer Authentication (Phone / KBA / Password / Gov ID) → Custom Auth Wall

**Adobe Sign:** Built-in recipient identity verification —
`memberInfos[].securityOption` for phone (SMS), knowledge-based authentication
(KBA), password, or government ID before signing.

**Anvil:** No built-in signer authentication of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL:
1. Verify a code / OTP via your existing provider (Twilio, etc.).
2. Use your app's existing MFA as a gate before signing.
3. For embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## Web Forms (Widgets) → Anvil Workflows / Embedded Packets

**Adobe Sign:** A **widget** (`POST /widgets`) is a hosted, reusable public form —
one URL that anyone can open, fill, and sign, spawning an agreement per submission.

**Anvil:** No single "public reusable signable form" primitive that maps 1:1.

**Workaround:**
1. **Anvil Workflows** — for a hosted, multi-step data-collection + sign experience
   (the closest match); or
2. **Per-request embedded packets** — create an Etch packet on demand behind your
   own form/landing page and embed the signing UI with `AnvilEmbedFrame`.

**Impact:** Medium-High — an architectural decision if widgets carry real traffic.
Confirm how the widget is used before choosing.

---

## Wet-Ink Signatures (`signatureType: WRITTEN`) → Not Supported

**Adobe Sign:** `signatureType: 'WRITTEN'` routes a print-sign-fax/upload flow.

**Anvil:** E-sign only.

**Workaround:** Keep those flows on the existing provider, or move them to true
e-sign. Confirm none of the migrated templates rely on `WRITTEN`.

**Impact:** Low (rarely used) / High (if a template depends on it).

---

## OAuth Multi-Tenant / `x-api-user` → Separate Orgs or API Keys

**Adobe Sign:** OAuth (on behalf of other accounts) and the `x-api-user` header let
your app act as many Adobe users/accounts (multi-tenant SaaS).

**Anvil:** No OAuth-on-behalf or impersonation. Each Anvil organization has its own
API key.

**Workaround:**
1. **Single org with template separation** — one Anvil account; track which
   templates belong to which tenant in your database.
2. **Separate orgs per tenant** — each tenant gets its own Anvil org and API key
   (stored encrypted), for full isolation.
3. **Anvil reseller/white-label program** — contact Anvil for multi-tenant SaaS
   use cases.

**Impact:** High — an architectural decision. Discuss with the developer first.

---

## White Labeling → Anvil CSS Themes

**Adobe Sign:** Branding via account settings (logo, colors).

**Anvil:** CSS-based theming of the signing UI — more control than Adobe's branding.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes) and
configure it in the Anvil dashboard under API settings > white labeling.

**Impact:** Low — more powerful, but requires a CSS file.

---

## Agreement Metadata (`externalId`, custom fields) → Your Own DB

**Adobe Sign:** `externalId` and custom fields ride along on an agreement.

**Anvil:** Packets have no metadata bag.

**Workaround:** Store source metadata (your record ID, tenant, workflow state) in
your own database, keyed by `etchPacketEid`. You likely already do this.

**Impact:** Low.

---

## Content / Reflowing Agreements → Dynamic Docs (optional)

**Adobe Sign:** Most library documents are fixed PDFs, but some agreements are
authored from rich content (text/HTML authoring, workflow-composed documents) where
a frozen PDF loses structure.

**Anvil:** Beyond the PDF path (the default — a flat PDF template with detected
fields), Anvil also has **dynamic documents** — structured content templates with
reflowing text, real tables, and **repeating table rows** bound to array data. See
`template-migration.md` for the dynamic-doc authoring flow (create → `updateCast`
content tree → publish).

**When to consider it:** only for content-heavy or reflowing agreements, or ones
that should stay editable in Anvil. For a straight fixed-PDF library document, use
**PDF + Document AI** — it preserves the exact layout. Dynamic docs are a *rebuild*,
not a conversion, and their content-tree format is Anvil-internal/undocumented.

**Not a fix for:** reminders/expiration (e-sign packet concerns, unrelated to the
document format). Signatures can't live inside a repeating row.

**Impact:** Optional — a fidelity upgrade for specific templates, not the default.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Participant roles → fields | Equivalent (explicit field assignment) | Low-Medium |
| Alternate members in a set (signing group) | Semantics differ (parallel vs any-one) | Medium |
| Merge fields → prefill | Equivalent (different structure) | Low |
| CC / certified recipients | Non-signing recipients / app-level | Low-Medium |
| Signing order | Direct (`routingOrder`) | None |
| Embedded signing | Direct (`AnvilEmbedFrame`) | None |
| Reject / decline | App-level UI + state | Low-Medium |
| Expiration & reminders | App-level scheduling | Low-Medium |
| Bulk send (MegaSign) | Loop with rate limiting | Medium |
| Signer authentication | Custom auth wall | Medium-High |
| Web forms (widgets) | Anvil Workflows / embedded packets | Medium-High |
| Wet-ink (`WRITTEN`) | Not supported | Low / High if used |
| OAuth multi-tenant / `x-api-user` | Separate orgs / keys | High |
| White labeling | CSS themes (more powerful) | Low |
| Agreement metadata | Your own DB | Low |
