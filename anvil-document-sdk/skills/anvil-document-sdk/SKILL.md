---
name: anvil-document-sdk
description: >
  Implement Anvil API integrations (PDF Filling, HTML-to-PDF Generation, Etch E-Sign, Workflows) into any existing Node.js or TypeScript codebase.
  Use this skill whenever a developer mentions Anvil, PDF filling with Anvil, HTML to PDF, generating PDFs from HTML/CSS,
  e-signatures with Anvil, Etch packets, Anvil Workflows, forgeSubmit, castEid, generatePDF, or wants to add document automation,
  PDF generation, or e-signature capabilities using the Anvil platform. Also trigger when someone asks about integrating
  paperwork automation, document signing, or PDF template filling into their app — even if they don't say "Anvil" by name
  but the context suggests Anvil is the tool they're using or should use.
---

# Anvil API Integration Skill

You are helping a developer integrate Anvil's APIs into their existing codebase. Anvil provides four core capabilities — PDF Filling, PDF Generation (HTML/CSS to PDF), Etch E-Sign, and Workflows — all accessed through a single Node.js client library. Your job is to understand what the developer needs, figure out where it fits in their codebase, and write production-ready integration code.

## Quick Start vs. Full Implementation

When a developer is first implementing Anvil, **always give them the choice** between a Quick Start and jumping straight into their real use case. Ask: **"Would you like to try a 5-minute quick start first to make sure everything is wired up correctly? Or would you prefer to jump straight into implementing your actual use case?"**

- If they choose **Quick Start** → walk them through the steps below, then transition to Phase 1 Discovery.
- If they choose **full implementation** → skip directly to Phase 1: Discovery below.

## Quick Start

If the developer chose the Quick Start, walk them through these steps in order:

### Step 1: Get the sample template's castEid

Ask: **"Do you have a sample PDF template set up in Anvil? If so, give me the `castEid` — you can find it on the template's settings page in the Anvil dashboard."**

If they don't have one yet, direct them to upload any simple PDF to the Anvil dashboard, tag a few fields, publish it, and grab the `castEid`. They can also use one of Anvil's built-in sample templates if available in their account.

### Step 2: Get the sample payload

Ask: **"What's the sample data payload you'd like to fill the template with? Give me a JSON object where the keys match the field aliases you tagged on the template."**

For example:
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "email": "jane@example.com",
  "date": "2026-03-12"
}
```

### Step 3: Set up the API key

Ask the developer to add their Anvil API key as an environment variable right now. Give them two options:

**Option A — `.env` file** (recommended):
```
ANVIL_API_KEY=<add api key>
```
Confirm `.env` is in `.gitignore`.

**Option B — Terminal export** (quick test):
```bash
export ANVIL_API_KEY=<add api key>
```

Wait for confirmation before proceeding. Do not ask them to paste the key into the chat.

### Step 4: Write the fill code

Install the dependency and create a minimal fill function:

```bash
npm install @anvilco/anvil
```

```typescript
import Anvil from '@anvilco/anvil'

const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

async function fillSamplePDF() {
  const { statusCode, data: pdfBuffer } = await anvilClient.fillPDF(
    '<castEid from step 1>',
    { data: <payload from step 2> }
  )

  if (statusCode !== 200) {
    throw new Error(`Fill failed with status ${statusCode}`)
  }

  return pdfBuffer
}
```

Use the actual `castEid` and payload the developer provided. Wire this into a route handler or a simple script they can run to verify the PDF comes back correctly.

### Step 5: Add a trigger in the UI

Ask: **"Is there a good place in your app to put a button that triggers the PDF to be filled out and downloaded? For example, a 'Generate PDF' button on a detail page, a dashboard action, or a toolbar item."**

Based on their answer, write a route handler that calls the fill function and returns the PDF buffer as a download, plus a frontend button or link that hits that route. Keep it simple — the goal is a working end-to-end flow they can click and see a PDF download to their machine.

### Step 6: Try E-Sign (offer after Quick Start)

Once the PDF fill is working, offer to extend it into a signature packet: **"Nice — your PDF fill is working. Want to take it one step further and turn that same template into a signature packet? We can send it to someone for e-signature via email in just a few more lines of code."**

If they want to try it:

**6a. Get signer details**

Ask: **"Who should sign this document? Give me a name and email address."**

For example:
```
Name: Jane Smith
Email: jane@example.com
```

**6b. Write the Etch packet code**

Add a function that creates a signature packet using the same `castEid` from the Quick Start and sends it to the signer via email:

```typescript
async function sendForSignature(
  castEid: string,
  signerName: string,
  signerEmail: string
) {
  const { statusCode, data, errors } = await anvilClient.createEtchPacket({
    variables: {
      name: `Quick Start Signature - ${signerName}`,
      isDraft: false,
      isTest: true, // watermarked, doesn't count against plan
      signers: [
        {
          id: 'signer1',
          name: signerName,
          email: signerEmail,
          signerType: 'email', // Anvil sends the email
          fields: [
            // Map signer to at least one signature field on the template.
            // The fieldId must match a field alias tagged on the PDF in Anvil.
            { fileId: 'sampleDoc', fieldId: '<signatureFieldAlias>' },
          ],
        },
      ],
      files: [
        {
          id: 'sampleDoc',
          castEid: castEid,
        },
      ],
    },
  })

  if (errors) {
    throw new Error(`Etch packet creation failed: ${JSON.stringify(errors)}`)
  }

  return data?.data?.createEtchPacket
}
```

Ask the developer: **"What is the field alias for the signature field on your template? You can find it in the Anvil template editor — it's the alias you assigned to the signature box."** Plug that value into the `fieldId`. If the template has additional fields (date, initials), add those to the `fields` array too.

**6c. Wire it up**

Add a route or script that calls `sendForSignature` with the signer's name, email, and the `castEid` from Step 1. When it runs, Anvil sends the signer an email with a link to sign the document.

```typescript
app.post('/api/quick-start/send-for-signature', async (req, res) => {
  try {
    const { signerName, signerEmail } = req.body
    const castEid = '<castEid from step 1>'

    const packet = await sendForSignature(castEid, signerName, signerEmail)

    res.json({
      message: `Signature request sent to ${signerEmail}`,
      packetEid: packet.eid,
    })
  } catch (error) {
    console.error('Failed to send for signature:', error)
    res.status(500).json({ error: 'Failed to create signature packet' })
  }
})
```

Tell the developer: **"Run this, then check the signer's email — they should receive a signing link from Anvil. Since we used `isTest: true`, the document will be watermarked but otherwise fully functional."**

### After Quick Start

Once the quick start is working (PDF fill, and optionally e-sign), transition to the full discovery flow: **"Great, you've got a working Anvil integration. Now let's set up your real use case — which Anvil capability do you need?"** Continue with Phase 1 below.

---

## Phase 1: Discovery

Before writing any code, you need to understand the developer's situation. Ask these questions (adapt based on what you already know from context):

### Which Anvil product?

Ask: **"Which Anvil capability do you need?"**
- **PDF Filling** — Fill existing PDF templates with structured data on demand (e.g., generating W-4s, tax forms, contracts from a pre-designed PDF)
- **PDF Generation** — Create brand-new PDFs from HTML & CSS or structured Markdown data (e.g., invoices, reports, agreements where the layout is defined in code)
- **Etch E-Sign** — Send documents for e-signature, optionally embedded in your app
- **Workflows** — Multi-step data collection with webforms, PDF filling, and e-signatures combined

If the developer is unsure, help them figure it out based on their use case. **PDF Filling** is for populating an existing PDF template with data — the PDF layout already exists, you just fill in the blanks. **PDF Generation** is for creating documents from scratch using HTML/CSS or Markdown — there's no pre-existing PDF, the layout comes from code. Etch is for when documents need signatures. Workflows are for multi-step processes that combine data collection, document generation, and signing.

### API key situation

Ask: **"Do you already have an Anvil API key, and is it a development key or production key?"**
- If yes: ask whether it's a development or production key (see below), then ask them to add it to their `.env` file right now before continuing.
- If no: direct them to create an account at https://app.useanvil.com/signup, then find their API key under Organization Settings > API Settings. They'll get a development key (rate-limited to 4 req/s) and a production key.

**Development vs. Production key:** Clarify which key they're using. If they plan to use the **production key**, confirm that they have a credit card on file — without one, API calls will fail due to feature gating. They can add a card at `https://app.useanvil.com/org/<org-slug>/settings/billing`. Reassure them that Anvil bills only for actual usage consumed, and when first adding a credit card they receive free credits: 2,500 PDF fill/generation calls, 25 e-sign packets, and 25 workflow submissions. Development keys work without a card but are rate-limited (2 requests/second vs. 40/second for production) and watermark output.

**Action step — do this now:** Before moving on, ask the developer to make their API key available as an environment variable. Give them two options:

**Option A — Add it to your `.env` file** (recommended for projects using dotenv):
```
ANVIL_API_KEY=<add api key>
```
If they go this route, confirm that `.env` is in their `.gitignore` (if it isn't, add it).

**Option B — Export it in your terminal session** (quick option for testing):
```bash
export ANVIL_API_KEY=<add api key>
```

Wait for the developer to confirm the key is in place before proceeding — the migration script and all integration code depend on this environment variable being set. Do not ask the developer to paste their API key into the chat.

### Codebase context

Ask: **"Where in your codebase should the Anvil integration live?"** Specifically:
- What triggers the Anvil action? (a button click, a form submission, a cron job, an API call from another service)
- Where should the server-side code go? (which directory, existing service file, or new module)
- If the product involves UI (embedded signing, embedded workflows): what frontend framework are they using? Is it React?

### Template setup (for PDF Filling and Etch — skip for PDF Generation)

Ask: **"Have you already uploaded and tagged your PDF template(s) in the Anvil dashboard?"**
- If yes: get the `castEid` (the template identifier). They can find it in the Anvil UI on the template's settings page.
- If no: explain the recommended approach — upload the PDF to Anvil using the dashboard or the `createCast` mutation, use the Anvil UI to tag fields with aliases that match their data model, publish the template, and then use the resulting `castEid` in code. This tagging step is important because it maps PDF fields to the developer's data schema and is much easier to do visually in the Anvil UI than programmatically.

### Template field introspection (do this for every new template)

When the developer provides a `castEid` for a template, **always query the template's fields from Anvil** to understand the data structure the application needs to provide. Use the `requestGraphQL()` method on the client to fetch the Cast and its fields:

```typescript
const QUERY_CAST_FIELDS = `
  query GetCast($eid: String!) {
    cast(eid: $eid) {
      eid
      name
      fieldInfo {
        casts {
          castEid
          fields {
            castFieldEid
            fieldAlias
            fieldType
            pageNum
          }
        }
      }
    }
  }
`

const { data } = await anvilClient.requestGraphQL({
  query: QUERY_CAST_FIELDS,
  variables: { eid: castEid },
})
const fields = data?.data?.cast?.fieldInfo?.casts?.[0]?.fields ?? []
```

For each field returned, use the **`fieldAlias`** as the key in data payloads. If `fieldAlias` is not set (null/empty), fall back to the **`castFieldEid`**. The `fieldType` tells you the data type (e.g., `'fullName'`, `'email'`, `'date'`, `'phone'`, `'ssn'`, `'signature'`, `'initial'`, `'checkbox'`, `'dropdown'`, etc.).

Once you have the field list, do the following:

1. **Separate data fields from signature fields.** Signature-type fields (`fieldType` of `'signature'`, `'initial'`, `'signatureDate'`) are not filled with data — they are assigned to signers in Etch packets. All other fields are data fields that get populated via `fillPDF` or the `data.payloads` in `createEtchPacket`.

2. **Construct a typed data payload interface** that maps each data field's alias (or castFieldEid) to the appropriate TypeScript type based on `fieldType`. For example:

   ```typescript
   // Generated from template field introspection
   interface TemplatePayload {
     employeeName: string       // fieldType: 'fullName'
     email: string              // fieldType: 'email'
     startDate: string          // fieldType: 'date'
     ssn: string                // fieldType: 'ssn'
     filingStatus: string       // fieldType: 'dropdown'
     agreeToTerms: boolean      // fieldType: 'checkbox'
   }
   ```

3. **Wire the payload into the application.** Map fields from the developer's existing data model to the template's field aliases. Ask: **"Here are the fields on your template: [list field aliases and types]. How do these map to your application's data? For example, does `employeeName` come from `user.fullName`?"**

4. **For Etch packets — handle signature fields proactively.** If the template has signature-type fields, list them out for the developer and ask how to assign them. Say: **"I see [N] signature fields on this template: [list each field alias/name and type, e.g., 'employeeSignature (signature)', 'employeeInitials (initial)', 'signDate (signatureDate)']. How would you like me to assign these to signers? For example, do they all belong to one signer, or are some for a countersigner?"**

This introspection step ensures the code you write matches exactly what the template expects — no guessing field names or types.

### PDF migration (always offer — use the bundled script)

Always ask: **"Would you like help migrating your existing PDFs into Anvil as templates? I have a migration script that can bulk-upload your PDFs and pre-populate field aliases from your application's data schema."**

When the developer wants to migrate PDFs, **always use the bundled `scripts/migrate-pdfs-to-anvil.ts` script** — don't write upload code from scratch. The script handles `createCast` mutations, multipart file uploads via `Anvil.prepareGraphQLFile()`, AI-powered field detection, rate limiting, and manifest generation.

**AI-Powered Field Detection:** The migration script enables `detectBoxesAdvanced` and `advancedDetectFields` by default when uploading PDFs via `createCast`. These flags use Anvil's AI to automatically detect form fields and map them to field aliases from the developer's schema. If field aliases are available and `advancedDetectFields` is enabled, the script passes them up so the AI can use the developer's actual field names when detecting fields. If the Anvil organization doesn't have AI detection enabled (the server returns an error about the feature not being available), the script automatically retries the upload with those flags set to `false` — falling back to standard field detection without any manual intervention.

If they want to migrate:

1. **Ask to inspect the codebase schema.** Ask: **"Can I inspect your codebase to extract field names from your data models? This lets me pass your field names up to Anvil as suggested field aliases in the `createCast` mutation, so when you tag fields in the Anvil template editor, your application's field names are already pre-populated — no manual entry needed. If your Anvil plan supports AI detection, your field names will also be used by the AI to automatically match detected fields to your data model."**

   If they grant permission, look for schema definitions in their codebase:
   - **Prisma models** (`schema.prisma` → extract field names from model definitions)
   - **Sequelize/TypeORM models** (model definition files → extract column names)
   - **JSON Schema files** (look for `properties` keys)
   - **TypeScript interfaces/types** (extract property names from the relevant data types)
   - **Database migration files** (extract column names from CREATE TABLE or addColumn statements)
   - **GraphQL schema files** (extract field names from type definitions)

   Extract the relevant field names and write them to a temporary JSON schema file (flat object or array format) that the migration script can consume. For example:

   ```json
   ["firstName", "lastName", "email", "dateOfBirth", "ssn", "address", "city", "state", "zipCode"]
   ```

   If the developer declines or there's no schema to inspect, the script will still upload the PDFs — they'll just need to tag fields manually in the Anvil dashboard.

2. Ask for the **location of their PDF files** — either a local directory path or a Google Drive URL.

3. **Run the migration script.** Copy `scripts/migrate-pdfs-to-anvil.ts` into the developer's project and run it:

   ```bash
   # Install dependency if not already present
   npm install @anvilco/anvil

   # Run the migration (with schema for field aliases)
   npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./path/to/pdfs --schema ./extracted-schema.json

   # Or without schema (PDFs only, no pre-populated aliases)
   npx ts-node scripts/migrate-pdfs-to-anvil.ts --dir ./path/to/pdfs
   ```

   The script:
   - Reads the schema file (if provided) and extracts field keys
   - Scans the directory for all `.pdf` files
   - Uploads each PDF to Anvil via `createCast` with `detectBoxesAdvanced: true` and `advancedDetectFields: true` enabled by default for AI-powered field detection
   - Passes `fieldAliases` from the schema when `advancedDetectFields` is enabled, so the AI can match detected fields to the developer's data model
   - If the org doesn't have AI detection enabled, automatically retries with those flags set to `false` (standard detection, no aliases)
   - Uses `Anvil.prepareGraphQLFile()` for proper multipart uploads through the client library
   - Respects rate limits (500ms delay between uploads, configurable with `--delay`)
   - Outputs an `anvil-migration-manifest.json` mapping each filename to its `castEid`

4. After the script runs, remind the developer to:
   - Open each template in the Anvil dashboard to review the auto-suggested field aliases
   - Adjust field tagging visually (the aliases from their schema will be pre-loaded)
   - Publish each template
   - Use the `castEid` values from the manifest in their integration code

### For PDF Generation specifically

Also ask:
- **"Do you want to generate from HTML & CSS, or from structured data (Markdown mode)?"** — HTML mode gives full layout control and works with any frontend framework (React, Vue, Handlebars, EJS). Markdown mode is simpler — you provide labels, content, and tables as structured JSON and Anvil handles the layout.
- **"Do you already have an HTML template or component for this document, or do we need to create one?"** — If they have an existing React component, invoice template, or similar, we can render it to HTML server-side and send it to Anvil. If not, we'll build one.
- **"What page size do you need?"** — Default is US Letter (8.5" × 11"). A4 is `210mm × 297mm`. Custom sizes are supported.
- **"Where should the generated PDF be stored — returned directly to the user, saved to a blob store (S3, GCS, Azure Blob), or both?"** — Same storage question as other products. Always ask if they don't specify.

### For Etch E-Sign specifically

Also ask:
- **"Will signers sign within your app (embedded) or via Anvil's email flow?"** — This determines whether to use `signerType: 'embedded'` with `generateEtchSignURL`, or let Anvil handle email delivery.
- **"Which signature, date, and initial fields on each PDF belong to which signer?"** — Every signer must be mapped to at least one field on a document. The packet will fail if a signer has no fields assigned. The `fieldId` values must match field aliases on the PDF template in Anvil. You should already have the signature fields from the template field introspection step above — list them out and ask the developer to assign them. For example: **"I see 3 signature fields: 'employeeSignature', 'employeeInitials', and 'managerSignature'. How should I assign these — 'employeeSignature' and 'employeeInitials' to the employee signer, and 'managerSignature' to a manager countersigner?"**
- **"Do any documents need interactive fields (fields the signer fills in, not just signs)?"** — If yes, those fields must also be explicitly assigned to a specific signer or they won't appear.
- **"What should happen after signing completes?"** — This determines webhook/event handler setup.
- **"How should completed signed documents be retrieved?"** — Three dimensions to clarify:
  - **Trigger:** Automatically when signing completes (webhook handler downloads and stores them), on demand when a user clicks a "Download" button (API route fetches from Anvil), or both? Webhook-triggered is good for archiving and triggering downstream processes. On-demand is good for user-facing download buttons.
  - **Format:** All files as a single zip, or each file individually? Zip is simpler for archiving. Individual downloads are better when documents need to be routed separately (e.g., NDA to legal, offer letter to HR).
  - **Storage:** Where should the downloaded documents be stored? Most production integrations save documents to a blob store (S3, Google Cloud Storage, Azure Blob) rather than local disk. Ask: **"Where should signed documents be stored — S3, another cloud storage provider, your local filesystem, or somewhere else?"** Also ask: **"Do you already have a database table where you want to associate the downloaded PDF, or do we need to create one?"** If the developer doesn't specify, always ask — don't assume local filesystem storage.

### For Workflows specifically

Also ask:
- **"Will the webforms be embedded in your app or hosted by Anvil?"** — Determines iframe embedding setup.
- **"What should happen at each stage of the workflow?"** — Understand the callback/webhook needs.
- **"Where should completed workflow documents be stored?"** — Same as Etch: ask about blob store (S3, GCS, Azure Blob) vs. local filesystem, and whether they have an existing database table to associate the documents with or need a new one.

### Custom styling (for any embedded UI)

If the integration involves embedded components (Etch signing, Workflows webforms), ask: **"Would you like the embedded Anvil UI to match your app's look and feel? If so, I can generate a custom CSS stylesheet from your existing site. You can also skip this and style it later."**

If they want custom styling:
1. Ask for a URL from their app (or marketing site) that represents their brand's visual style
2. Fetch that URL and extract the key design tokens: primary/secondary colors, font family, border radius, button styles, spacing
3. Transform these into an Anvil-compatible CSS file using `anvil-*` CSS classes and variables. Use the Anvil themes repo (https://github.com/anvilco/anvil-themes) as a starting point — the `material.css` file shows the available selectors and structure.
4. The generated CSS file needs to be hosted at a publicly accessible HTTPS URL. Suggest they serve it from their existing static assets or a CDN.
5. The stylesheet URL is configured in the Anvil dashboard: `https://app.useanvil.com/org/<org-slug>/settings/api` under the "White labeling" section, or per-workflow in individual workflow settings. Reference: https://www.useanvil.com/docs/api/white-labeling/

This step is optional — the integration works fine without it — but it makes a big difference for user experience when the signing/form UI looks like part of their app rather than a third-party embed.

## Phase 2: Implementation Plan

Once you understand the developer's needs, create a clear implementation plan before writing code. The plan should cover:

1. **Dependencies to install** — which npm packages
2. **Files to create or modify** — with specific paths in their codebase
3. **Database changes** (if needed) — a table or columns to associate Anvil EIDs with internal models
4. **Environment variables** — what to add to `.env`
5. **The integration flow** — step by step, what happens when the user triggers the action
6. **Webhook registrations** — which events to subscribe to and what the handler should do for each

Present this plan and get approval before writing code.

## Phase 3: Write the Code

### Core Setup (all products)

Every Anvil integration starts with:

1. **Install the client library:**
   ```bash
   npm install @anvilco/anvil
   ```

2. **Create an Anvil service module.** Place it where the developer specified (e.g., `src/services/anvil.ts` or `lib/anvil/client.ts`). This module initializes the client and exports product-specific functions:

   ```typescript
   import Anvil from '@anvilco/anvil'

   const anvilClient = new Anvil({
     apiKey: process.env.ANVIL_API_KEY,
   })

   export { anvilClient }
   ```

   The API key comes from an environment variable. Remind the developer to add `ANVIL_API_KEY=their_key_here` to their `.env` file and ensure `.env` is in `.gitignore`.

3. **If using React for embedded UIs**, also install the embed component:
   ```bash
   npm install @anvilco/anvil-embed-frame
   ```
   `AnvilEmbedFrame` handles e-signature embedding, workflow embedding, and embedded builders. It replaces the older `@anvilco/react-signature-frame` (which only supported e-sign).

### Product-Specific Implementation

Read the appropriate reference file for detailed implementation patterns:

- **PDF Filling** → Read `references/pdf-filling.md`
- **PDF Generation (HTML/CSS to PDF)** → Read `references/html-to-pdf.md`
- **Etch E-Sign** → Read `references/etch-esign.md`
- **Workflows** → Read `references/workflows.md`
- **Webhooks** (all products) → Read `references/webhooks.md`

Each reference contains the specific API calls, data structures, and code patterns for that product. The webhooks reference applies to all products and should always be read alongside the product-specific reference — every Etch and Workflow integration needs webhook handlers.

## Best Practices (apply to all integrations)

These practices come from real-world Anvil implementations. Follow them closely — they prevent the most common integration mistakes.

### Template Management
Templatize PDFs before using them in code. Upload the PDF to Anvil (via dashboard or `createCast` mutation), tag fields in the Anvil UI with aliases that match the developer's data model, publish the template, and use the resulting `castEid` in code. This visual tagging step is far more reliable than trying to map fields programmatically.

### EID Storage
Create or modify a database table that associates Anvil EIDs (for templates, packets, submissions, etc.) with the app's internal user/organization model. Anvil is a document processing engine, not an access control system — manage who can access what in your own app, not in Anvil.

### On-Demand Execution
- **PDF fills:** Call the fill endpoint when the user needs the document (e.g., button click → API call → return PDF). The endpoint is fast and doesn't need pre-generation.
- **Etch packets:** Create the packet when the user is ready to sign (e.g., "Sign Documents" button → create packet → redirect to signing). Don't pre-create packets.
- **Workflow submissions:** Create/update via `forgeSubmit` at the moment the workflow needs to start.

### API Key Security
Store the API key as an environment variable (`ANVIL_API_KEY`). The Anvil client library is server-only — it will fail in a browser environment. Never import or reference it in client-side code.

### Payload Encryption
Anvil provides RSA encryption keys and a dedicated encryption library (`@anvilco/encryption`) for securing data in transit. When sending sensitive information (PII, SSNs, financial data) to Anvil, use encryption:

1. Generate an RSA keypair from your organization's settings page in the Anvil dashboard
2. Install the encryption helper: `npm install @anvilco/encryption`
3. Use `encryptRSA` to encrypt payloads before sending them to Anvil

```typescript
import { encryptRSA } from '@anvilco/encryption'

const encryptedPayload = encryptRSA(
  process.env.ANVIL_RSA_PUBLIC_KEY,
  JSON.stringify(sensitiveData)
)
```

The library uses hybrid RSA+AES encryption (AES encrypts the data, RSA encrypts the AES key) so there's no size limit on the payload. Encourage developers to use encryption for any integration handling personal or sensitive data — it's a small addition that significantly improves the security posture.

### Webhooks and Events
Always set up webhook handlers for Etch and Workflow integrations. Use the `createWebhookAction` GraphQL mutation to register for events programmatically — this makes the integration self-contained rather than depending on dashboard configuration. See `references/webhooks.md` for the full registration and handler patterns.

For every integration, ask the developer: **"What should happen when [event] occurs?"** Common actions include downloading the completed signed PDFs (via `downloadDocuments`), updating order/application status, sending confirmation emails, or triggering the next step in a process. Provide the webhook registration code and a handler skeleton with `// --- Developer: add your logic here ---` placeholders, then let the developer fill in the business logic or prompt you to write it.

For embedded UIs (iframe-based signing or workflows), also wire up iframe `postMessage` event listeners alongside webhooks — the iframe events give instant client-side feedback while webhooks handle the server-side processing.

### Document Storage
Always ask the developer where they want to store downloaded/generated PDFs and how they want to track them. They may already have a storage abstraction or an existing database table for document records. If they don't specify, always ask — don't assume any storage approach.

**Preferred approach: Store PDFs as BLOBs in the application database.** When a developer says "save it to my database," the schema should include a `BYTEA` (Postgres) or `BLOB` (MySQL/SQLite) column to store the actual PDF contents. Each PDF should be stored as an individual row. For cloud blob stores (S3, GCS, Azure Blob), store the buffer there and save the resulting URL + metadata to a database row instead.

**Always download all documents — including the signing certificate.** Completed Etch packets and Workflows produce signed PDFs **plus a signing certificate** — an audit trail PDF that records who signed, when, their IP addresses, and signature verification details. Always download and store the certificate alongside the signed documents for legal compliance.

**Packet / submission grouping:** PDFs resulting from Etch E-Sign or Workflows belong to a parent object that groups the documents together. Every downloaded document must be associated to its Anvil EID — `etchPacketEid` for e-sign packets, `weldDataEid` for workflow submissions. Use a two-table pattern:

1. **A packet table** that represents the container — call it `etch_packets` (for e-sign) or `workflow_packets` (for workflows). This table stores the Anvil EID (`packet_eid` / `weld_data_eid`), a `type` column identifying the kind of packet (e.g., `'nda_signing'`, `'employee_onboarding'`), status, and metadata.
2. **A documents table** that stores individual PDFs as BLOBs, each linked back to the packet via a foreign key. Every row has the PDF content (`BYTEA`/`BLOB`), the filename, content type, the Anvil file EID, the `packet_eid` or `weld_data_eid` (denormalized for easy querying), and a `document_type` column (`'signed_document'`, `'signing_certificate'`, or `'filled_document'`) to distinguish between document types.

This mirrors how Anvil organizes things internally (documentGroups contain individual files), but uses developer-friendly naming. See the Database Schema sections in `references/etch-esign.md` and `references/workflows.md` for the full schema.

For **PDF Filling** and **PDF Generation**, there's no parent packet — each generated PDF is standalone. Store it as a single BLOB row linked to whatever entity triggered the generation (user, invoice, report, etc.).

### Client Library Preference — All API Requests Must Go Through the Client
**Every API request to Anvil must be routed through the Anvil client library when one exists for the developer's language.** Do not make direct HTTP calls or raw GraphQL requests alongside the client — use the client's built-in methods for everything, including GraphQL queries and mutations that aren't covered by a dedicated helper method.

The official Node.js client (`@anvilco/anvil`) provides:
- **Dedicated methods** for common operations: `fillPDF()`, `generatePDF()`, `createEtchPacket()`, `generateEtchSignURL()`, `forgeSubmit()`, `downloadDocuments()`
- **`requestGraphQL()`** for any GraphQL query or mutation not covered by a dedicated method (e.g., `createWebhookAction`, `removeWebhookAction`, `createCast`). Always use this instead of making raw `fetch`/`axios` calls to `https://graphql.useanvil.com`
- **`prepareGraphQLFile()`** for multipart file uploads through GraphQL mutations
- Built-in authentication, rate limiting, retries, and error handling

```typescript
// CORRECT: Route all requests through the client
import Anvil from '@anvilco/anvil'
const anvilClient = new Anvil({ apiKey: process.env.ANVIL_API_KEY })

// Dedicated method
const { data: pdfBuffer } = await anvilClient.fillPDF(castEid, payload)

// GraphQL via client — for mutations without a dedicated helper
const { data } = await anvilClient.requestGraphQL({
  query: `mutation CreateWebhookAction($input: JSON!) {
    createWebhookAction(
      action: "etchPacketComplete"
      objectType: "EtchPacket"
      objectEid: $eid
      url: $url
    ) { eid }
  }`,
  variables: { eid: packetEid, url: webhookURL },
})

// File upload via client
const file = Anvil.prepareGraphQLFile('./template.pdf')
const { data: cast } = await anvilClient.requestGraphQL({
  query: CREATE_CAST_MUTATION,
  variables: { file, title: 'My Template' },
})
```

```typescript
// WRONG: Do not bypass the client with raw HTTP calls
// const response = await fetch('https://graphql.useanvil.com', { ... })  // ❌
// const response = await axios.post('https://graphql.useanvil.com', ...) // ❌
```

### When No Client Library Exists

If no official client library exists for the developer's language (e.g., Go, Rust, PHP without a community client), you must implement API calls directly. In this case:

1. **Create a centralized Anvil client module** that handles authentication, rate limiting, and retries. All API calls should go through this module — never scattered raw HTTP calls.
2. For **file uploads**, use Anvil's GraphQL API with multipart form data following the [GraphQL multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec):
   - Send a `POST` to `https://graphql.useanvil.com` with `Content-Type: multipart/form-data`
   - Include the `operations` field with the GraphQL query/mutation (file placeholders set to `null`)
   - Include the `map` field mapping each file to its variable path
   - Include each file as a named form part

```typescript
// Example: Direct multipart upload ONLY when no client library exists
const FormData = require('form-data')
const fs = require('fs')

const form = new FormData()
form.append('operations', JSON.stringify({
  query: `mutation CreateCast($file: Upload!, $title: String, $detectBoxesAdvanced: Boolean, $advancedDetectFields: Boolean, $fieldAliases: [JSON!]) {
    createCast(file: $file, title: $title, detectBoxesAdvanced: $detectBoxesAdvanced, advancedDetectFields: $advancedDetectFields, fieldAliases: $fieldAliases) { eid name fieldInfo }
  }`,
  variables: {
    file: null,
    title: 'My Template',
    detectBoxesAdvanced: true,
    advancedDetectFields: true,
    fieldAliases: [{ fieldAlias: 'firstName' }, { fieldAlias: 'lastName' }], // from schema
  },
}))
form.append('map', JSON.stringify({ '0': ['variables.file'] }))
form.append('0', fs.createReadStream('./template.pdf'), {
  filename: 'template.pdf',
  contentType: 'application/pdf',
})

const response = await fetch('https://graphql.useanvil.com', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    ...form.getHeaders(),
  },
  body: form,
})
```

This direct approach is only for languages without an Anvil client library. For Node.js/TypeScript, always use `anvilClient.requestGraphQL()` and `Anvil.prepareGraphQLFile()` instead.

### Rate Limiting
Anvil enforces rate limits per API key: **production keys** allow **40 requests/second**, **development keys** allow **2 requests/second**. When using the official `@anvilco/anvil` Node.js client, rate limiting and retries are handled automatically — the client reads rate-limit headers and backs off on 429s.

**If the codebase does not use the Node.js client** (e.g., a different language, or direct HTTP calls), you **must** implement rate limiting yourself. Always prefer an existing Anvil client library that fits the language and technology stack. If no official library exists for the developer's language, implement a throttle/retry mechanism that:
1. Tracks the rate limit from `X-RateLimit-Limit` and `X-RateLimit-Remaining` response headers
2. On a `429 Too Many Requests` response, reads the `Retry-After` header and waits before retrying
3. Uses exponential backoff with jitter for retries
4. Queues outgoing requests to stay under the per-second limit

Reference: https://www.useanvil.com/blog/engineering/throttling-and-consuming-apis-with-429-rate-limits/

### Error Handling
Wrap API calls in try/catch and handle:
- Authentication errors (invalid/expired API key)
- Validation errors (malformed payload, missing required fields)
- Not found errors (invalid EID)
- Rate limit errors (429 — see Rate Limiting above)

### React Component Usage
When the developer's frontend uses React, prefer the official Anvil React components:
- `@anvilco/anvil-embed-frame` (`AnvilEmbedFrame`) — for embedding any Anvil UI (signing, workflows, builders)
- This replaces `@anvilco/react-signature-frame` which was e-sign only

Before using iframe embedding, the developer **must** enable it and whitelist their domains in the Anvil dashboard. Direct them to `https://app.useanvil.com/org/<org-slug>/settings/api` where they need to:
1. Enable "Iframe Embedding" under the API section
2. Add their application's domain(s) to the whitelist (e.g., `localhost:3000` for development, `app.example.com` for production)

Without this step, embedded components will refuse to load in their app's iframes. This is a common gotcha that blocks developers at the last mile.

## Reference Links

When the developer needs more context, point them to:
- Getting started: https://www.useanvil.com/docs/api/getting-started/
- PDF Generation (HTML/CSS to PDF): https://www.useanvil.com/docs/api/generate-pdf/
- GraphQL reference: https://www.useanvil.com/docs/api/graphql/reference/
- Node.js client: https://github.com/anvilco/node-anvil
- React components: https://github.com/anvilco/react-ui
- Example apps: https://github.com/anvilco/anvil-api-usage-examples
- Webhooks: https://www.useanvil.com/docs/api/webhooks/
- White-labeling / CSS theming: https://www.useanvil.com/docs/api/white-labeling/
- CSS theme templates: https://github.com/anvilco/anvil-themes
- Rate limiting guide: https://www.useanvil.com/blog/engineering/throttling-and-consuming-apis-with-429-rate-limits/
- Billing: https://app.useanvil.com/org/<org-slug>/settings/billing
