# DropboxSign → Anvil Feature Parity Reference

This document lists DropboxSign features that don't have a direct 1:1 equivalent in Anvil, along with recommended workarounds. When migrating, **always surface these gaps to the developer** — never silently drop a feature.

---

## Templates with Roles → Signer IDs Mapped to Fields

**DropboxSign:** Templates define named roles (e.g., "Client", "Manager"). Signers are assigned to roles by name, and all fields tagged for that role are automatically assigned.

**Anvil:** Templates have fields with aliases. Signers are defined with arbitrary IDs, and you explicitly map each signer to specific fields via the `fields[]` array in `createEtchPacket`.

**Workaround:** When migrating, create a role-to-signer-ID mapping. For each DropboxSign role, define an Anvil signer ID (e.g., role "Client" → signer ID `client`). Then explicitly list all fields that role's signer needs to sign. This is more verbose but gives you finer-grained control.

**Impact:** Low — requires listing fields explicitly, but this is a one-time setup per template.

---

## Merge Fields → Data Payloads with Field Aliases

**DropboxSign:** Merge fields are key-value pairs passed as `custom_fields` and automatically matched by name to template fields.

**Anvil:** Data is passed via `data.payloads.{fileId}.data` where keys are field aliases set on the template in the Anvil dashboard.

**Workaround:** When uploading templates to Anvil, tag fields with aliases that match your existing merge field names. Then replace `custom_fields` with the `data.payloads` structure. If you use the same field names as aliases, the data mapping is nearly identical — just the structure wrapper changes.

**Impact:** Low — mostly a structural change in the API call.

---

## Bulk Send → Loop with Rate Limiting

**DropboxSign:** Dedicated `BulkSendJob` API that sends the same template to many signers in a single API call.

**Anvil:** No built-in bulk send API.

**Workaround:** Loop over `createEtchPacket` calls with rate limiting. Production keys support 40 requests/second. The Anvil Node.js client handles rate limiting and retries automatically.

```typescript
async function bulkSend(
  signerList: Array<{ name: string; email: string; data: Record<string, any> }>,
  castEid: string
) {
  const results = []
  for (const signer of signerList) {
    const { data, errors } = await anvilClient.createEtchPacket({
      variables: {
        name: `Packet for ${signer.name}`,
        isDraft: false,
        isTest: false,
        signers: [
          {
            id: 'signer1',
            name: signer.name,
            email: signer.email,
            signerType: 'email',
            fields: [{ fileId: 'doc', fieldId: 'signatureField' }],
          },
        ],
        files: [{ id: 'doc', castEid }],
        data: { payloads: { doc: { data: signer.data } } },
      },
    })
    results.push({ signer: signer.email, eid: data?.data?.createEtchPacket?.eid, errors })
  }
  return results
}
```

**Impact:** Medium — requires implementing a loop, but the Anvil client handles rate limiting automatically.

---

## SMS Authentication → Custom Auth Wall

**DropboxSign:** Built-in SMS authentication option for signers — requires phone number verification before signing.

**Anvil:** No built-in SMS authentication for signers.

**Workaround:** Implement an authentication wall in your application before redirecting to the Anvil signing URL. Options:
1. Send an SMS verification code via your existing SMS provider (Twilio, etc.) before generating the sign URL
2. Use your app's existing MFA/2FA flow as a gate before signing
3. Use Anvil's embedded signing with `clientUserId` to tie signing sessions to authenticated users

**Impact:** Medium-High — requires building an auth flow if SMS verification is critical for compliance.

---

## Decline to Sign → App-Level Decline Flow

**DropboxSign:** Built-in "Decline to Sign" button in the signing UI. Fires `signature_request_declined` webhook.

**Anvil:** No built-in decline button in the signing UI.

**Workaround:** Implement a decline flow in your application:
1. Add a "Decline" button alongside the embedded signing frame
2. When clicked, record the decline in your database
3. Optionally cancel the Etch packet or notify other parties
4. Handle the flow the same way you handled the `signature_request_declined` webhook

**Impact:** Low-Medium — straightforward UI addition, but needs custom state management.

---

## Signing Order → Anvil `routingOrder`

**DropboxSign:** `signing_order` field on signers to enforce sequential signing.

**Anvil:** `routingOrder` integer field on each signer in `createEtchPacket`. Signers with the same `routingOrder` sign in parallel; lower numbers sign first.

**Workaround:** Direct mapping — replace `signing_order` / `order` with `routingOrder`.

```typescript
// DropboxSign
signers: [
  { role: 'Employee', order: 1, ... },
  { role: 'Manager', order: 2, ... },
]

// Anvil
signers: [
  { id: 'employee', routingOrder: 1, ... },
  { id: 'manager', routingOrder: 2, ... },
]
```

**Impact:** None — direct equivalent.

---

## Signing Redirect URL → `AnvilEmbedFrame` `onEvent`

**DropboxSign:** `signing_redirect_url` parameter redirects the signer to a URL after signing is complete.

**Anvil:** For embedded signing, use `AnvilEmbedFrame`'s `onEvent` callback to detect `signerComplete` and redirect programmatically. For email-based signing, Anvil redirects to a default completion page (configurable in the dashboard).

**Workaround:**

```typescript
<AnvilEmbedFrame
  iframeURL={signURL}
  onEvent={(event) => {
    if (event.action === 'signerComplete') {
      window.location.href = '/signing-complete'
    }
  }}
/>
```

**Impact:** None — functionally equivalent, just a different mechanism.

---

## White Labeling → Anvil CSS Themes

**DropboxSign:** White labeling via dashboard settings (logo, colors, background).

**Anvil:** CSS-based theming with full control over the signing UI appearance. Host a custom CSS file and configure it in the Anvil dashboard under API settings > White labeling.

**Workaround:** Create a CSS theme file using the Anvil theme structure (see https://github.com/anvilco/anvil-themes). This gives more control than DropboxSign's white labeling — you can customize fonts, colors, spacing, and layout. For multi-tenant apps, per-tenant branding lives on each tenant's own organization — a child org (or the tenant's own OAuth-authorized org) carries its own theme, replacing the API App's `white_labeling_options`.

**Impact:** Low — more powerful than DropboxSign's approach, but requires creating a CSS file.

---

## OAuth Multi-Tenant → Anvil OAuth Apps or Child Organizations

**DropboxSign:** An API App (`client_id` / `client_secret`) plus the OAuth flow lets your app act on behalf of other Dropbox Sign accounts (multi-tenant SaaS) — each grant returns an account-scoped token, and the app's `white_labeling_options` brand the signing UI for every account that uses it.

**Anvil:** Supported — Anvil is multi-tenant too. Two first-class paths cover on-behalf sending, plus a lightweight single-org option. Pick one deliberately; it determines credential storage and webhook routing.

**Option A — OAuth apps (your tenants own their Anvil accounts).** Register an OAuth app on your Anvil organization (`createOAuthApp` / Organization Settings > OAuth apps) with an `appName` and `redirectUri`; you get a `clientId` and `clientSecret`. Other Anvil organizations authorize your app through the redirect flow, and you receive a scoped token that acts against *their* organization. This is the direct analogue of a Dropbox Sign API App plus OAuth grant: you never hold a tenant's API key, and either side can revoke access (`revokeOAuthApp`). OAuth is an Enterprise feature — confirm it is enabled on your org and get the current authorize/token endpoints and scope list from Anvil before you build against it.

**Option B — child organizations (you provision tenants yourself).** An Anvil org can be the parent of an unlimited number of child organizations. Each child is a real, isolated org: its own templates, branding/theme, users, webhook, and its own development and production API keys — while billing and administration roll up to the parent. Create children in the dashboard, or via the API with `createOrganization(name, slug, parentEid)`, then mint that child's key with `addOrganizationAPIKey`. Store the per-child key encrypted and select it per tenant at send time. Use this when your product owns each tenant's workspace rather than connecting to an account the tenant already has. Child organizations are an Enterprise feature — confirm enablement with Anvil.

**Option C — one org, `replyTo` per packet.** If tenants only need to *appear* as the sender (not to own data), stay in a single org and set `replyToName` / `replyToEmail` on each `createEtchPacket`. This is the cheapest path but gives no data isolation — every tenant's packets and templates live in the same org.

### Mapping

| DropboxSign | Anvil |
|-------------|-------|
| API App (`client_id` / `client_secret`) | Anvil OAuth app (`clientId` / `clientSecret`) — Option A |
| OAuth grant; app acts for another account | Scoped token against that tenant's own Anvil org (Option A) |
| Per-tenant OAuth tokens or API keys in your DB | Per-tenant child-org API keys, stored encrypted (Option B) |
| `account_id` selected per request | The child org's own API key (Option B) — no account selection |
| API App `white_labeling_options` | The child org's own CSS theme (see White Labeling), or the tenant org's theme in Option A |
| One `callback_url` fanning out across accounts | Each org (child or OAuth-authorized) carries its own webhook |
| Per-tenant template libraries | Templates live in each child org (B), or one org with tenant-tagged templates (C) |

**Ask the developer:** do your tenants already have — or want — their own Anvil accounts (→ OAuth apps), or does your product provision and own each tenant's workspace (→ child organizations)? Do tenants need isolated templates and data, or only a distinct sender identity (→ `replyTo` in a single org)?

**Impact:** Medium — a real architectural choice, but there is genuine parity here. Decide before writing send code, since the credential lookup and webhook routing differ per option.

---

## Signature Request Expiration → Sign URL TTL vs Packet Lifetime

**DropboxSign:** `expires_at` parameter on signature requests — the request expires and can no longer be signed after this date.

**Anvil:** Etch sign URLs have a TTL (time-to-live), but the packet itself doesn't expire. You can generate new sign URLs for the same packet at any time.

**Workaround:** Options:
1. **Manage expiration in your app** — Track a deadline in your database. After the deadline, stop generating new sign URLs and mark the packet as expired in your system.
2. **Use sign URL TTL** — Generate sign URLs close to when the signer needs them. The URLs expire after a set period.
3. **Cancel the packet** — If you need to enforce hard expiration, implement a scheduled job that cancels packets after a deadline.

**Impact:** Low-Medium — requires app-level expiration logic if hard expiration is needed.

---

## Summary Table

| Feature | Parity | Workaround Effort |
|---------|--------|-------------------|
| Templates with roles | Equivalent (different structure) | Low |
| Merge fields | Equivalent (different structure) | Low |
| Bulk send | Loop with rate limiting | Medium |
| SMS authentication | Custom auth wall | Medium-High |
| Decline to sign | App-level UI + state | Low-Medium |
| Signing order | Direct equivalent (`routingOrder`) | None |
| Signing redirect URL | `AnvilEmbedFrame` `onEvent` | None |
| White labeling | CSS themes (more powerful) | Low |
| OAuth multi-tenant | OAuth apps or child orgs | Medium |
| Request expiration | App-level + sign URL TTL | Low-Medium |
