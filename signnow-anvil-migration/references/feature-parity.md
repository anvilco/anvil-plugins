# signNow → Anvil Feature Parity Reference

signNow features that don't map 1:1 to Anvil, with recommended workarounds. When
migrating, **always surface the relevant gaps to the developer** — never silently
drop a feature.

---

## Two-Step OAuth → Single API Key

**signNow:** A Basic client credential (`base64(client_id:client_secret)`) is
exchanged at `POST /oauth2/token` for a Bearer access token; every other call
carries the Bearer token, and tokens expire / refresh.

**Anvil:** One long-lived `ANVIL_API_KEY` on every call.

**Workaround:** Delete the token-exchange and refresh logic. Replace the client
id/secret + access/refresh tokens with a single API key.

**Impact:** None — a simplification.

---

## Roles → Signer IDs Mapped to Fields

**signNow:** Fields carry a `role` (e.g. "Signer 1"). A field invite binds an email
to each role; that signer gets every field tagged for the role.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary
IDs, and you explicitly map each signer to the fields they own via `fields[]` in
`createEtchPacket`.

**Workaround:** Create a role → signer-ID mapping (e.g. role "Signer 1" → signer id
`signer1`). List the fields each role owns and assign them to that signer.

**Impact:** Low — more explicit, but a one-time setup per template.

---

## Prefill (`prefill-texts`) → Data Payloads

**signNow:** Non-signature fields are prefilled with
`PUT /v2/documents/{id}/prefill-texts` (`field_name` / `prefilled_text`), editable
by the signer, or with smart-field / text-tag prefill.

**Anvil:** Data is passed via `data.payloads.{fileId}.data`, keyed by field alias.

**Workaround:** Map each `field_name` to an Anvil field alias and move the values
into `data.payloads`. If you keep the same names as aliases, the mapping is nearly
one-to-one — only the structure wrapper changes.

**Impact:** Low — a structural change in the API call.

---

## CC / Non-Signing Recipients

**signNow:** `cc[]` on an invite delivers the completed document to recipients who
don't sign.

**Anvil:** No dedicated CC list on a packet.

**Workaround:**
1. Add them as Anvil signers with no signature fields (if your org allows
   non-signing signers), so they get the completion email.
2. Handle delivery in your app on `etchPacketComplete` — download the documents and
   notify the CC parties yourself.

**Impact:** Low-Medium — a one-time decision per flow.

---

## Signing Order → Anvil `routingOrder`

**signNow:** Each `to[]` recipient on a field invite carries an `order` integer.
Lower acts first; equal values act in parallel.

**Anvil:** `routingOrder` (integer) on each signer. Identical semantics.

**Workaround:** Direct mapping — `order` → `routingOrder`.

**Impact:** None — direct equivalent.

---

## Embedded Signing → `AnvilEmbedFrame`

**signNow:** Create an embedded invite (`POST /v2/documents/{id}/embedded-invites`),
then generate its `/link`, then iframe the returned URL.

**Anvil:** Set `signerType: 'embedded'`, call `generateEtchSignURL`, embed with
`AnvilEmbedFrame`, handle the `signerComplete` event.

**Workaround:** Direct mapping (see `api-mapping.md`) — two signNow calls collapse
to one `generateEtchSignURL`. Remember to allowlist your domains in the Anvil
dashboard.

**Impact:** None — functionally equivalent.

---

## Decline to Sign → App-Level Decline Flow

**signNow:** The `decline_by_signature` invite option shows a "Decline" button in
the signing UI; declines surface via events.

**Anvil:** No built-in decline button.

**Workaround:** Add a "Decline" button alongside the embedded signing frame. On
click, record the decline in your database, optionally void the packet, and notify
the other parties — the same handling you had for the decline event.

**Impact:** Low-Medium — a straightforward UI addition with custom state.

---

## Invite Expiration & Reminders → App-Level Scheduling

**signNow:** Field invites accept `expiration_days` (the invite expires) and
`reminder` (remind after N days).

**Anvil:** Etch sign URLs have a TTL, but the packet itself doesn't expire, and
Anvil doesn't schedule reminder emails from these invite settings.

**Workaround:**
1. **Expiration** — track a deadline in your database; after it passes, stop
   generating sign URLs and mark the packet expired (optionally void it).
2. **Reminders** — schedule reminder emails from your app, or trigger a fresh Anvil
   signing email when you need to nudge a signer.

**Impact:** Low-Medium — app-level scheduling if hard deadlines/reminders matter.

---

## Bulk / Mass Send → Loop with Rate Limiting

**signNow:** Mass-send flows (send one template to many recipients) are built by
looping the copy → invite calls, or via bulk-invite features.

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
          id: 'signer1', name: r.name, email: r.email, signerType: 'email',
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
limiting.

---

## Signer Authentication (Phone / SMS / Password) → Custom Auth Wall

**signNow:** Built-in recipient authentication — phone-call/SMS OTP or a
password/access code before a signer can open the document.

**Anvil:** No built-in signer authentication of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL:
1. Verify an access code or SMS/OTP via your existing provider (Twilio, etc.).
2. Use your app's existing MFA as a gate before signing.
3. For embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## Signing History / Audit Trail → Certificate in the Download Zip

**signNow:** The signed PDF (`/download?type=collapsed`) and the signing **history /
audit trail** are separate downloads.

**Anvil:** `downloadDocuments` returns the signed PDFs **and** the signing
certificate in a single zip.

**Workaround:** Stop fetching the audit trail separately — read the certificate
from the Anvil download zip. Always store it for legal compliance.

**Impact:** Low — one download instead of two.

---

## OAuth Multi-Tenant → Anvil OAuth Apps or Child Organizations

**signNow:** The OAuth authorization-code grant lets your app act on behalf of other
signNow accounts, and the password grant (`SIGNNOW_USERNAME` / `SIGNNOW_PASSWORD`)
mints a token for a specific user — one app credential, many acting identities
(multi-tenant SaaS).

**Anvil:** Supported — Anvil is multi-tenant too. Two first-class paths cover
on-behalf sending, plus a lightweight single-org option. Pick one deliberately; it
determines credential storage and webhook routing.

**Option A — OAuth apps (your tenants own their Anvil accounts).** Register an
OAuth app on your Anvil organization (`createOAuthApp` / Organization Settings →
OAuth apps) with an `appName` and `redirectUri`; you get a `clientId` and
`clientSecret`. Other Anvil organizations authorize your app through the redirect
flow, and you receive a scoped token that acts against *their* organization. This is
the closest analogue to signNow's authorization-code grant: you never hold a
tenant's credentials, and either side can revoke access (`revokeOAuthApp`). Unlike
signNow's tokens, an Anvil OAuth token needs no refresh dance on every call. OAuth
is an Enterprise feature — confirm it is enabled on your org and get the current
authorize/token endpoints and scope list from Anvil before you build against it.

**Option B — child organizations (you provision tenants yourself).** An Anvil org
can be the parent of an unlimited number of child organizations. Each child is a
real, isolated org: its own templates, branding/theme, users, webhook, and its own
development and production API keys — while billing and administration roll up to
the parent. Create children in the dashboard, or via the API with
`createOrganization(name, slug, parentEid)`, then mint that child's key with
`addOrganizationAPIKey`. Store the per-child key encrypted and select it per tenant
at send time. This replaces the per-user password grant: instead of exchanging a
tenant's username/password for a token, you look up that tenant's child-org key.
Child organizations are an Enterprise feature — confirm enablement with Anvil.

**Option C — one org, `replyTo` per packet.** If tenants only need to *appear* as
the sender (not to own data), stay in a single org and set `replyToName` /
`replyToEmail` on each `createEtchPacket`. This is the cheapest path but gives no
data isolation — every tenant's packets and templates live in the same org.

### Mapping

| signNow | Anvil |
|---------|-------|
| Authorization-code grant; app acts for another account | OAuth app → scoped token against that org (Option A) |
| Password grant per user (`SIGNNOW_USERNAME` / `SIGNNOW_PASSWORD`) | Child org per tenant + that child's API key (Option B) |
| Per-tenant access/refresh tokens in your DB | Per-tenant child-org API keys, stored encrypted (Option B) — no refresh |
| Account-level branding | The child org's own CSS theme (see White Labeling) |
| One event subscription across accounts | Each org (child or OAuth-authorized) carries its own webhook |
| Per-tenant template libraries | Templates live in each child org (B), or one org with tenant-tagged templates (C) |
| Sender identity only, no isolation needed | `replyToName` / `replyToEmail` per packet (Option C) |

**Ask the developer:** do your tenants already have — or want — their own Anvil
accounts (→ OAuth apps), or does your product provision and own each tenant's
workspace (→ child organizations)? Do tenants need isolated templates and data, or
only a distinct sender identity (→ `replyTo` in a single org)?

**Impact:** Medium — a real architectural choice, but there is genuine parity here.
Decide before writing send code, since the credential lookup and webhook routing
differ per option.

---

## White Labeling → Anvil CSS Themes

**signNow:** Branding (logo, colors) configured in account settings.

**Anvil:** CSS-based theming of the signing UI — more control than signNow's
branding.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes) and
configure it in the Anvil dashboard under API settings > white labeling. For
multi-tenant apps, per-tenant branding lives on each tenant's own organization — a
child org (or the tenant's own OAuth-authorized org) carries its own theme, so one
brand per org replaces per-account signNow branding.

**Impact:** Low — more powerful, but requires a CSS file.

---

## Document Metadata → Your Own Database

**signNow:** Documents carry a `document_name` and can be organized in folders, but
there is no arbitrary metadata bag that travels with the document on webhooks.

**Anvil:** Etch packets have **no metadata bag** either.

**Workaround:** Store any source metadata (tenant, template family, internal IDs) in
your own database keyed by `etchPacketEid`. You receive the packet EID on webhooks,
so join to your own record there.

**Impact:** Low — a small storage change; you likely track this already.

---

## Content / Reflowing Templates → Dynamic Docs (optional)

**signNow:** Templates are **flat PDFs with positioned fields** — content doesn't
reflow, and there's no native "repeat this row per line item" concept.

**Anvil:** Beyond the PDF path (the default, which preserves the exact PDF), Anvil
also has **dynamic documents** — structured content templates with reflowing text,
real tables, and **repeating table rows** bound to array data. See
`template-migration.md` for the tiered rule and authoring flow (create →
`updateCast` content tree → publish).

**When to consider it:** only if a signNow template would benefit from reflowing
content or repeating line-item tables that a fixed PDF can't provide. For a straight
migration, **use the PDF + Document AI path** — it preserves the exact layout and
field placement. Dynamic docs are a *rebuild*, not a conversion.

**Not a fix for:** reminders/expiration (those are e-sign concerns, unrelated to
document format — see above). Signatures can't live inside a repeating row.

**Impact:** Optional — a fidelity upgrade for specific templates, not part of the
default path.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Two-step OAuth → single key | Simplification | None |
| Roles → signer IDs mapped to fields | Equivalent (more explicit) | Low |
| Prefill → data payloads | Equivalent (different structure) | Low |
| CC / non-signing recipients | Non-signing signers / app-level | Low-Medium |
| Signing order | Direct (`routingOrder`) | None |
| Embedded signing | Direct (`AnvilEmbedFrame`) | None |
| Decline to sign | App-level UI + state | Low-Medium |
| Expiration & reminders | App-level scheduling | Low-Medium |
| Bulk / mass send | Loop with rate limiting | Medium |
| Signer authentication (phone/SMS/password) | Custom auth wall | Medium-High |
| Signing history / audit trail | Certificate in the download zip | Low |
| OAuth multi-tenant | OAuth apps or child orgs | Medium |
| White labeling | CSS themes (more powerful) | Low |
| Document metadata | Store in your own DB | Low |
| Content / reflowing templates | Dynamic docs (optional) | Optional |
