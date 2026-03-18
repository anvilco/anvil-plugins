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

**Workaround:** Create a CSS theme file using the Anvil theme structure (see https://github.com/anvilco/anvil-themes). This gives more control than DropboxSign's white labeling — you can customize fonts, colors, spacing, and layout.

**Impact:** Low — more powerful than DropboxSign's approach, but requires creating a CSS file.

---

## OAuth Multi-Tenant → Separate Orgs or API Key Separation

**DropboxSign:** OAuth flow allows your app to act on behalf of other HelloSign accounts (multi-tenant SaaS).

**Anvil:** No OAuth equivalent. Each Anvil organization has its own API key.

**Workaround:** Options depend on your multi-tenant architecture:
1. **Single Anvil org with template separation** — Use one Anvil account and organize templates by tenant. Track which templates belong to which tenant in your database.
2. **Separate Anvil orgs per tenant** — Each tenant gets their own Anvil organization and API key. Store API keys per tenant in your database (encrypted). This provides full isolation.
3. **Anvil reseller program** — Contact Anvil about their reseller/white-label program for multi-tenant SaaS use cases.

**Impact:** High — requires architectural decisions. Discuss with the developer before proceeding.

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
| OAuth multi-tenant | Separate orgs or template separation | High |
| Request expiration | App-level + sign URL TTL | Low-Medium |
