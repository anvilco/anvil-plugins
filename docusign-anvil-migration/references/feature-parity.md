# DocuSign → Anvil Feature Parity Reference

DocuSign features that don't map 1:1 to Anvil, with recommended workarounds.
When migrating, **always surface the relevant gaps to the developer** — never
silently drop a feature.

---

## Template Roles → Signer IDs Mapped to Fields

**DocuSign:** Templates define named role placeholders (`roleName`). Tabs are
tagged for a role; assigning a person to the role at send time gives them all of
that role's tabs.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary
IDs, and you explicitly map each signer to the fields they own via `fields[]` in
`createEtchPacket`.

**Workaround:** Create a role → signer-ID mapping (e.g. role `Signer` → signer id
`signer`). The template converter (see `template-migration.md`) reconstructs the
role → field associations automatically, so this is mostly a naming exercise.

**Impact:** Low — the converter does the heavy lifting.

---

## Tab Value / prefillTabs → Data Payloads

**DocuSign:** Prefilled data is supplied as tab `value`s on `templateRoles[].tabs`,
via sender-only `prefillTabs`, or by matching AcroForm fields with
`transformPdfFields`.

**Anvil:** Data is passed via `data.payloads.{fileId}.data`, keyed by field alias.

**Workaround:** During conversion, DocuSign `tabId`s become Anvil field aliases.
Key your payload data by those aliases (or re-alias fields to your own names in
the Anvil template editor first).

**Impact:** Low — a structural change in the API call.

---

## Carbon Copies / Certified Deliveries → Non-Signing Recipients

**DocuSign:** `carbonCopies` and `certifiedDeliveries` are recipients who receive
the completed documents (or a delivery receipt) without signing.

**Anvil:** The template converter parses **signers only** — CC/certified-delivery
recipients are not carried over.

**Workaround:** Re-add these recipients at packet-creation time. Options:
1. Add them as Anvil signers with no signature fields (if your org allows
   non-signing signers), so they get the completion email.
2. Handle delivery in your application on `etchPacketComplete` — download the
   documents and email/notify the CC parties yourself.

**Impact:** Low-Medium — a one-time decision per template.

---

## Agents / Editors / Intermediaries → App-Level Flow

**DocuSign:** `agents`, `editors`, and `intermediaries` are recipients who manage
*other* recipients (add names/emails, edit routing) mid-flow.

**Anvil:** No equivalent recipient-management role.

**Workaround:** These are rarely used in straightforward PDF-fill + sign flows. If
present, model the decision in your application: collect the downstream
recipients' details in your own UI before creating the packet, then pass them
directly as signers.

**Impact:** High if actually used — requires rethinking the flow. Confirm with the
developer whether these roles carry real behavior or are vestigial.

---

## Signing Order → Anvil `routingOrder`

**DocuSign:** `routingOrder` (string) on each recipient. Lower numbers act first;
equal values act in parallel.

**Anvil:** `routingOrder` (integer) on each signer. Identical semantics — lower
first, equal = parallel.

**Workaround:** Direct mapping. Convert the string to an integer.

**Impact:** None — direct equivalent.

---

## Embedded Signing → `AnvilEmbedFrame`

**DocuSign:** Set `clientUserId` on the recipient, call `createRecipientView`,
iframe the returned single-use URL, handle `returnUrl?event=` on completion.

**Anvil:** Set `signerType: 'embedded'`, call `generateEtchSignURL`, embed with
`AnvilEmbedFrame`, handle the `signerComplete` event.

**Workaround:** Direct mapping (see `api-mapping.md`). Remember to allowlist your
domains in the Anvil dashboard.

**Impact:** None — functionally equivalent.

---

## Decline to Sign → App-Level Decline Flow

**DocuSign:** Built-in "Decline" action in the signing UI; fires the
`envelope-declined` / `recipient-declined` Connect event.

**Anvil:** No built-in decline button.

**Workaround:** Add a "Decline" button alongside the embedded signing frame.
On click, record the decline in your database, optionally void the packet, and
notify the other parties — the same handling you had for the declined event.

**Impact:** Low-Medium — a straightforward UI addition with custom state.

---

## Envelope Expiration & Reminders → App-Level Scheduling

**DocuSign:** `notification.expirations` (expire after N days) and
`notification.reminders` (remind every N days) on the envelope.

**Anvil:** Etch sign URLs have a TTL, but the packet itself doesn't expire, and
Anvil doesn't schedule reminder emails from these template settings.

**Workaround:**
1. **Expiration** — track a deadline in your database; after it passes, stop
   generating sign URLs and mark the packet expired (optionally void it).
2. **Reminders** — schedule reminder emails from your app, or trigger a fresh
   Anvil signing email when you need to nudge a signer.

**Impact:** Low-Medium — app-level scheduling if hard deadlines/reminders matter.

---

## Voiding an Envelope → App-Level / Packet Void

**DocuSign:** `PUT /envelopes/{id}` with `status: 'voided'` and a `voidedReason`.

**Anvil:** Packets can be voided, but the reason/notification flow differs.

**Workaround:** Void the Anvil packet and manage the reason + notifications in your
application. Track voided state in your own database, as you likely already do.

**Impact:** Low.

---

## Bulk Send (BulkEnvelopes) → Loop with Rate Limiting

**DocuSign:** `bulk_send_lists` sends one template to many recipients (up to 1,000
per list) in a single asynchronous batch.

**Anvil:** No built-in bulk send API.

**Workaround:** Loop over `createEtchPacket` with rate limiting. Production keys
support 40 requests/second; the Anvil Node client handles rate limiting and
retries automatically.

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

## Signer Authentication (Access Code / SMS / ID Check) → Custom Auth Wall

**DocuSign:** Built-in recipient authentication — `accessCode`, SMS, phone, or ID
Check before signing.

**Anvil:** No built-in signer authentication of these kinds.

**Workaround:** Gate access before generating the Anvil sign URL:
1. Verify an access code or SMS/OTP via your existing provider (Twilio, etc.).
2. Use your app's existing MFA as a gate before signing.
3. For embedded signing, tie sessions to authenticated users via `clientUserId`.

**Impact:** Medium-High — build an auth flow if verification is compliance-critical.

---

## OAuth Multi-Tenant / Send-On-Behalf → Anvil OAuth Apps or Child Organizations

**DocuSign:** The Authorization Code grant lets your app act on behalf of other
DocuSign accounts; JWT Grant with the `impersonation` scope acts as a specific user;
`/oauth/userinfo` returns every account a token can reach (each with its own
`accountId` and `base_uri`); and SOBO (`X-DocuSign-Act-As-User`) plus `brandId` let
one account send as another user or brand.

**Anvil:** Supported — Anvil is multi-tenant too. Two first-class paths cover
on-behalf sending, plus a lightweight single-org option. Pick one deliberately; it
determines credential storage and webhook routing.

**Option A — OAuth apps (your tenants own their Anvil accounts).** Register an
OAuth app on your Anvil organization (`createOAuthApp` / Organization Settings →
OAuth apps) with an `appName` and `redirectUri`; you get a `clientId` and
`clientSecret`. Other Anvil organizations authorize your app through the redirect
flow, and you receive a scoped token that acts against *their* organization. This is
the closest analogue to DocuSign's Authorization Code grant: you never hold a
tenant's API key, and either side can revoke access (`revokeOAuthApp`). OAuth is an
Enterprise feature — confirm it is enabled on your org and get the current
authorize/token endpoints and scope list from Anvil before you build against it.

**Option B — child organizations (you provision tenants yourself).** An Anvil org
can be the parent of an unlimited number of child organizations. Each child is a
real, isolated org: its own templates, branding/theme, users, webhook, and its own
development and production API keys — while billing and administration roll up to
the parent. Create children in the dashboard, or via the API with
`createOrganization(name, slug, parentEid)`, then mint that child's key with
`addOrganizationAPIKey`. Store the per-child key encrypted and select it per tenant
at send time. This replaces the `accountId` switching you did after
`/oauth/userinfo` — the child org *is* the account. Child organizations are an
Enterprise feature — confirm enablement with Anvil.

**Option C — one org, `replyTo` per packet.** If tenants only need to *appear* as
the sender (not to own data), stay in a single org and set `replyToName` /
`replyToEmail` on each `createEtchPacket`. This is the cheapest path but gives no
data isolation — every tenant's packets and templates live in the same org.

### Mapping

| DocuSign | Anvil |
|----------|-------|
| Authorization Code grant; app acts for another account | OAuth app → scoped token against that org (Option A) |
| JWT Grant + `impersonation` scope + `DOCUSIGN_USER_ID` | Child org per tenant + that child's API key (Option B) |
| `accountId` / `base_uri` chosen per tenant from `/oauth/userinfo` | The child org's own API key (Option B) — no discovery call |
| SOBO (`X-DocuSign-Act-As-User`) | Child org's API key (B), or `replyToName`/`replyToEmail` per packet (C) |
| `brandId` on an envelope | The child org's own CSS theme (see White Labeling), or `replyToName`/`replyToEmail` per packet |
| One Connect listener fanning out across accounts | Each org (child or OAuth-authorized) carries its own webhook |
| Per-tenant template libraries | Templates live in each child org (B), or one org with tenant-tagged templates (C) |

**Ask the developer:** do your tenants already have — or want — their own Anvil
accounts (→ OAuth apps), or does your product provision and own each tenant's
workspace (→ child organizations)? Do tenants need isolated templates and data, or
only a distinct sender identity (→ `replyTo` in a single org)?

**Impact:** Medium — a real architectural choice, but there is genuine parity here.
Decide before writing send code, since the credential lookup and webhook routing
differ per option.

---

## White Labeling → Anvil CSS Themes

**DocuSign:** Branding via the dashboard (logo, colors) with a `brandId` on the
envelope.

**Anvil:** CSS-based theming of the signing UI — more control than DocuSign's
branding.

**Workaround:** Create a CSS theme (see https://github.com/anvilco/anvil-themes)
and configure it in the Anvil dashboard under API settings > white labeling. Drop
the `brandId` from your create calls. For multi-tenant apps, per-tenant branding
lives on each tenant's own organization — a child org (or the tenant's own
OAuth-authorized org) carries its own theme, so one brand per org replaces one
`brandId` per envelope.

**Impact:** Low — more powerful, but requires a CSS file.

---

## Reflowing Layout / Repeating Rows → Dynamic Docs (optional)

**DocuSign:** A template is a fixed PDF. Content doesn't reflow, and there's no
native "repeat this row per line item" concept.

**Anvil:** Beyond the PDF converter (the default, which preserves the exact PDF),
Anvil also has **dynamic documents** — structured content templates with reflowing
text, real tables, and **repeating table rows** bound to array data. See the
`pandadoc-anvil-migration` plugin's `template-migration.md` for the dynamic-doc
authoring flow (create → `updateCast` content tree → publish).

**When to consider it:** only if a DocuSign template would benefit from reflowing
content or repeating line-item tables that a fixed PDF can't provide. For a
straight migration, **use the converter (Path A)** — it preserves the exact layout
and field placement. Dynamic docs are a *rebuild*, not a conversion.

**Not a fix for:** reminders/expiration (those are e-sign packet concerns, unrelated
to the document format — see above). Signatures can't live inside a repeating row.

**Impact:** Optional — a fidelity upgrade for specific templates, not part of the
default path.

---

## Summary Table

| Feature | Parity | Workaround effort |
|---------|--------|-------------------|
| Template roles → fields | Equivalent (converter handles it) | Low |
| Tab values / prefill | Equivalent (different structure) | Low |
| Carbon copies / certified delivery | Non-signing recipients / app-level | Low-Medium |
| Agents / editors / intermediaries | App-level flow | High (if used) |
| Signing order | Direct (`routingOrder`) | None |
| Embedded signing | Direct (`AnvilEmbedFrame`) | None |
| Decline to sign | App-level UI + state | Low-Medium |
| Expiration & reminders | App-level scheduling | Low-Medium |
| Voiding | App-level / packet void | Low |
| Bulk send | Loop with rate limiting | Medium |
| Signer authentication | Custom auth wall | Medium-High |
| OAuth multi-tenant / SOBO | OAuth apps or child orgs | Medium |
| White labeling | CSS themes (more powerful) | Low |
