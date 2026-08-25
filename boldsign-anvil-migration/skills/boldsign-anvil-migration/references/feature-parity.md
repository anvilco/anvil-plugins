# BoldSign → Anvil Feature Parity Reference

BoldSign features that don't map 1:1 to Anvil, with recommended workarounds. When
migrating, **always surface the relevant gaps to the developer** — never silently
drop a feature.

---

## Roles → Signer IDs Mapped to Fields

**BoldSign:** Templates define role slots (`roleIndex`, `signerRole`). Fields are
tagged to a role; assigning a person to the role at send time gives them all of
that role's fields.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary
IDs, and you explicitly map each signer to the fields they own via `fields[]` in
`createEtchPacket`.

**Workaround:** Create a role → signer-ID mapping (e.g. role "Customer" → signer id
`customer`). List the fields that role signs and assign them to that signer.

**Impact:** Low — a one-time naming exercise per template.

---

## Prefill (`value` / `existingFormFields`) → Data Payloads

**BoldSign:** Prefilled data is supplied as a form field's `value` on a fresh send,
or as `existingFormFields: [{ id, value }]` inside a role when sending from a
template (you fetch the field IDs from `/v1/template/properties` first).

**Anvil:** Data is passed via `data.payloads.{fileId}.data`, keyed by field alias.

**Workaround:** Map each BoldSign field `id`/`name` to an Anvil field alias, then
key your payload by those aliases. If you keep the same names as aliases, the data
mapping is nearly identical — only the structure wrapper changes.

**Impact:** Low — a structural change in the API call.

---

## CC Recipients → Non-Signing Recipients

**BoldSign:** `cc[]` is an array of email addresses that receive the completed
document without signing.

**Anvil:** No dedicated CC array on a packet.

**Workaround:** Re-add these recipients at packet-creation time. Options:
1. Add them as Anvil signers with no signature fields (if your org allows
   non-signing signers), so they get the completion email.
2. Handle delivery in your application on `etchPacketComplete` — download the
   documents and email/notify the CC parties yourself.

**Impact:** Low-Medium — a one-time decision per template.

---

## Signing Order → Anvil `routingOrder`

**BoldSign:** `signerOrder` (integer) per signer, gated by `enableSigningOrder`.
Lower numbers sign first; equal values sign in parallel.

**Anvil:** `routingOrder` (integer) per signer. Identical semantics; always in
effect (no separate enable flag).

**Workaround:** Direct mapping. Drop `enableSigningOrder` and set `routingOrder`.

**Impact:** None — direct equivalent.

---

## Embedded Signing → `AnvilEmbedFrame`

**BoldSign:** `GET /v1/document/getEmbeddedSignLink` returns a per-signer
`signLink`; you iframe it and handle the completion redirect/event.

**Anvil:** Set `signerType: 'embedded'`, call `generateEtchSignURL`, embed with
`AnvilEmbedFrame`, handle the `signerComplete` event.

**Workaround:** Direct mapping (see `api-mapping.md`). Remember to allowlist your
domains in the Anvil dashboard.

**Impact:** None — functionally equivalent.

---

## Embedded Request / Sending (`createEmbeddedRequestUrl`) → Embedded Builder

**BoldSign:** `POST /v1/document/createEmbeddedRequestUrl` (and the template
variant) returns a URL to BoldSign's *sender* UI, so a user can prepare, tag, and
send a document from inside your app — distinct from a *signer* signing.

**Anvil:** The counterpart is Anvil's **embedded packet builder**, rendered through
`AnvilEmbedFrame` with a builder URL — a different surface from `generateEtchSignURL`
(which is signer-side only).

**Workaround:** If you only ever *send* programmatically (typical for template-based
flows), you don't need this — build the packet server-side with `createEtchPacket`.
If end users genuinely compose/tag documents in-app, use the Anvil embedded builder
(reference the `anvil-document-sdk` skill for the builder embed).

**Impact:** Low if sending is programmatic; Medium if users compose documents in-app.

---

## Decline to Sign → App-Level Decline Flow

**BoldSign:** Built-in "Decline" action in the signing UI; fires the `Declined`
webhook event.

**Anvil:** No built-in decline button.

**Workaround:** Add a "Decline" button alongside the embedded signing frame. On
click, record the decline in your database, optionally void the packet, and notify
the other parties — the same handling you had for the `Declined` event.

**Impact:** Low-Medium — a straightforward UI addition with custom state.

---

## Expiration & Reminders → App-Level Scheduling

**BoldSign:** `expiryDays` / `expiryDateType` expire a document, and
`reminderSettings` (auto-reminders every N days) nudge signers.

**Anvil:** Etch sign URLs have a TTL, but the packet itself doesn't expire, and
Anvil doesn't schedule reminder emails from these settings.

**Workaround:**
1. **Expiration** — track a deadline in your database; after it passes, stop
   generating sign URLs and mark the packet expired (optionally void it).
2. **Reminders** — schedule reminder emails from your app, or trigger a fresh Anvil
   signing email when you need to nudge a signer.

**Impact:** Low-Medium — app-level scheduling if hard deadlines/reminders matter.

---

## Revoke / Void → App-Level / Packet Void

**BoldSign:** `POST /v1/document/revoke` cancels a document with a reason; fires
`Revoked` / `Voided`.

**Anvil:** Packets can be voided, but the reason/notification flow differs.

**Workaround:** Void the Anvil packet and manage the reason + notifications in your
application. Track voided state in your own database, as you likely already do.

**Impact:** Low.

---

## Bulk Send → Loop with Rate Limiting

**BoldSign:** Send the same template to many recipients programmatically. Note
BoldSign's account-level limit is **2,000 requests/hour** (~0.56 req/s) in
production, 50/hour in sandbox — bulk runs must pace against that.

**Anvil:** No built-in bulk send API, but production keys support **40
requests/second** — a far higher ceiling than BoldSign's hourly quota.

**Workaround:** Loop over `createEtchPacket`. The Anvil Node client handles rate
limiting and retries automatically.

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

**Impact:** Medium — a loop instead of a batch, but the client handles rate
limiting and Anvil's ceiling is higher.

---

## Signer Authentication (Access Code / SMS / Email OTP / ID) → Custom Auth Wall

**BoldSign:** Built-in recipient authentication — `authenticationType` /
`authenticationCode` for access code, SMS OTP, email OTP, or ID verification before
signing.

**Anvil:** No built-in signer authentication of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL:
1. Verify an access code or SMS/email OTP via your existing provider (Twilio, etc.).
2. Use your app's existing MFA as a gate before signing.
3. For embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## OAuth Multi-Tenant / On-Behalf → Anvil OAuth Apps or Child Organizations

**BoldSign:** OAuth 2.0 (authorization code) lets your app act on behalf of other
BoldSign accounts, and `onBehalfOf` / brand sends let one account send as a teammate
or brand (`BehalfDocument*` events).

**Anvil:** Supported — Anvil is multi-tenant too. Two first-class paths cover
on-behalf sending, plus a lightweight single-org option. Pick one deliberately; it
determines credential storage and webhook routing.

**Option A — OAuth apps (your tenants own their Anvil accounts).** Register an
OAuth app on your Anvil organization (`createOAuthApp` / Organization Settings →
OAuth apps) with an `appName` and `redirectUri`; you get a `clientId` and
`clientSecret`. Other Anvil organizations authorize your app through the redirect
flow, and you receive a scoped token that acts against *their* organization. This is
the closest analogue to BoldSign's OAuth-on-behalf: you never hold a tenant's API
key, and either side can revoke access (`revokeOAuthApp`). OAuth is an Enterprise
feature — confirm it is enabled on your org and get the current authorize/token
endpoints and scope list from Anvil before you build against it.

**Option B — child organizations (you provision tenants yourself).** An Anvil org
can be the parent of an unlimited number of child organizations. Each child is a
real, isolated org: its own templates, branding/theme, users, webhook, and its own
development and production API keys — while billing and administration roll up to
the parent. Create children in the dashboard, or via the API with
`createOrganization(name, slug, parentEid)`, then mint that child's key with
`addOrganizationAPIKey`. Store the per-child key encrypted and select it per tenant
at send time. Child organizations are an Enterprise feature — confirm enablement
with Anvil.

**Option C — one org, `replyTo` per packet.** If tenants only need to *appear* as
the sender (not to own data), stay in a single org and set `replyToName` /
`replyToEmail` on each `createEtchPacket`. This is the cheapest path but gives no
data isolation — every tenant's packets and templates live in the same org.

### Mapping

| BoldSign | Anvil |
|----------|-------|
| OAuth auth-code; app acts for another account | OAuth app → scoped token against that org (Option A) |
| One account sending `onBehalfOf` another user/tenant | Child org per tenant + that child's API key (Option B) |
| `brandId` on a send | The child org's own CSS theme (see White Labeling), or `replyToName`/`replyToEmail` per packet |
| `BehalfDocument*` webhook events | Ordinary `signerComplete` / `etchPacketComplete` on the acting org's webhook |
| Per-tenant template libraries | Templates live in each child org (B), or one org with tenant-tagged templates (C) |

**Ask the developer:** do your tenants already have — or want — their own Anvil
accounts (→ OAuth apps), or does your product provision and own each tenant's
workspace (→ child organizations)? Do tenants need isolated templates and data, or
only a distinct sender identity (→ `replyTo` in a single org)?

**Impact:** Medium — a real architectural choice, but there is genuine parity here.
Decide before writing send code, since the credential lookup and webhook routing
differ per option.

---

## White Labeling / Branding → Anvil CSS Themes

**BoldSign:** Branding via the dashboard (logo, colors) with brand IDs on the send.

**Anvil:** CSS-based theming of the signing UI — more control than a brand setting.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes) and
configure it in the Anvil dashboard under API settings > white labeling. Drop the
brand IDs from your send calls. For multi-tenant apps, per-tenant branding lives on
each tenant's own organization — a child org (or the tenant's own OAuth-authorized
org) carries its own theme, so one brand per org replaces one `brandId` per send.

**Impact:** Low — more powerful, but requires a CSS file.

---

## Document Metadata / Labels → Your Own Database

**BoldSign:** `labels` and metadata travel with a document and come back on
webhooks.

**Anvil:** Etch packets have **no metadata bag**.

**Workaround:** Store the metadata in your own database keyed by `etchPacketEid`.
You already receive the packet EID on webhooks, so join to your own record there.

**Impact:** Low — a small storage change; you likely track this data already.

---

## Reflowing Layout / Repeating Rows → Dynamic Docs (optional)

**BoldSign:** A template is a fixed PDF with positioned fields. Content doesn't
reflow, and there's no native "repeat this row per line item" concept.

**Anvil:** Beyond the PDF path (the default, which preserves the exact PDF), Anvil
also has **dynamic documents** — structured content templates with reflowing text,
real tables, and **repeating table rows** bound to array data. See
`template-migration.md` for the dynamic-doc authoring flow (create → `updateCast`
content tree → publish).

**When to consider it:** only if a BoldSign template would benefit from reflowing
content or repeating line-item tables that a fixed PDF can't provide. For a straight
migration, **use the PDF path** — it preserves the exact layout and field placement.
Dynamic docs are a *rebuild*, not a conversion (BoldSign has no content-tree export).

**Not a fix for:** reminders/expiration (e-sign packet concerns, unrelated to the
document format). Signatures can't live inside a repeating row.

**Impact:** Optional — a fidelity upgrade for specific templates, not part of the
default path.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Roles → signer IDs | Equivalent | Low |
| Prefill (`value` / `existingFormFields`) | Equivalent (different structure) | Low |
| CC recipients | Non-signing recipients / app-level | Low-Medium |
| Signing order | Direct (`routingOrder`) | None |
| Embedded signing | Direct (`AnvilEmbedFrame`) | None |
| Embedded request/sending | Anvil embedded builder | Low-Medium |
| Decline to sign | App-level UI + state | Low-Medium |
| Expiration & reminders | App-level scheduling | Low-Medium |
| Revoke / void | App-level / packet void | Low |
| Bulk send | Loop with rate limiting | Medium |
| Signer authentication | Custom auth wall | Medium-High |
| OAuth multi-tenant / on-behalf | OAuth apps or child orgs | Medium |
| White labeling | CSS themes (more powerful) | Low |
| Document metadata / labels | Store in your own DB | Low |
| Reflowing / repeating rows | Dynamic docs (optional rebuild) | Optional |
