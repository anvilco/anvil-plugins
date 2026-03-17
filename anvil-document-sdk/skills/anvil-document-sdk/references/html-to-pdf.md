# HTML to PDF Generation Reference

## Overview

Anvil's PDF Generation API lets you create brand-new PDFs from HTML & CSS or structured Markdown data. Unlike PDF Filling (which populates an existing template), this generates documents from scratch — useful for invoices, agreements, disclosures, reports, or any text-heavy document where the layout is defined in code rather than a pre-designed PDF.

The endpoint is `POST /api/v1/generate-pdf`. The Node.js client wraps this as `anvilClient.generatePDF()`.

## Prerequisites

- An Anvil API key (development or production)
- No template setup needed — the document layout comes from your HTML/CSS or Markdown payload

## Two Generation Modes

### Mode 1: HTML & CSS (full control)

Use this when you need pixel-perfect control over the layout. You can use any frontend technology that outputs string HTML and CSS — React, Vue, Handlebars, EJS, styled-components, LESS, SASS, etc. Render your component to an HTML string server-side, then send it to Anvil.

```typescript
import { anvilClient } from './anvil-client'

interface HTMLToPDFOptions {
  title: string
  html: string
  css?: string
  page?: {
    width?: string   // default '612px' (8.5")
    height?: string  // default '792px' (11")
    margin?: string  // default '50px', supports CSS shorthand
    marginTop?: string
    marginRight?: string
    marginBottom?: string
    marginLeft?: string
  }
}

export async function generatePDFFromHTML(options: HTMLToPDFOptions) {
  const payload: Record<string, any> = {
    type: 'html',
    title: options.title,
    data: {
      html: options.html,
      css: options.css ?? '',
    },
  }

  if (options.page) {
    payload.page = options.page
  }

  const { statusCode, data: pdfBuffer } = await anvilClient.generatePDF(payload)

  if (statusCode !== 200) {
    throw new Error(`PDF generation failed with status ${statusCode}`)
  }

  return pdfBuffer
}
```

### Mode 2: Markdown (structured data)

Use this for simpler documents where you want Anvil to handle the layout. You provide structured data (labels, content, tables) and Anvil formats them into a clean PDF. Good for quick reports, receipts, and data summaries.

```typescript
interface MarkdownPDFOptions {
  title: string
  fontFamily?: string // e.g., 'Roboto', 'Arial'
  data: Array<{
    label?: string
    content?: string
    heading?: string
    fontSize?: number      // 5–30
    textColor?: string     // 6-digit hex, e.g. '#333333'
    table?: {
      rows: string[][]
      firstRowHeaders?: boolean
      rowGridlines?: boolean
      columnGridlines?: boolean
      verticalAlign?: 'top' | 'middle' | 'bottom'
      columnOptions?: Array<{
        align?: 'left' | 'center' | 'right'
        width?: string  // pixels or percentage, e.g. '200px' or '50%'
      }>
    }
  }>
  page?: {
    width?: string
    height?: string
    margin?: string
    marginTop?: string
    marginRight?: string
    marginBottom?: string
    marginLeft?: string
  }
}

export async function generatePDFFromMarkdown(options: MarkdownPDFOptions) {
  const payload: Record<string, any> = {
    type: 'markdown',
    title: options.title,
    data: options.data,
  }

  if (options.fontFamily) payload.fontFamily = options.fontFamily
  if (options.page) payload.page = options.page

  const { statusCode, data: pdfBuffer } = await anvilClient.generatePDF(payload)

  if (statusCode !== 200) {
    throw new Error(`PDF generation failed with status ${statusCode}`)
  }

  return pdfBuffer
}
```

## Page Configuration

The `page` object controls document dimensions. Defaults to US Letter (8.5" × 11") with 50px margins.

Supported CSS units: `mm`, `cm`, `in`, `px`, `em`, `rem`, `pt`, `pc`.

```typescript
const page = {
  width: '8.5in',
  height: '11in',
  margin: '0.5in',          // all sides
  // Or specify per-side (overrides margin for that side):
  marginTop: '1in',
  marginBottom: '0.75in',
}
```

Common page sizes:
- **US Letter:** `{ width: '8.5in', height: '11in' }` (default)
- **A4:** `{ width: '210mm', height: '297mm' }`
- **Legal:** `{ width: '8.5in', height: '14in' }`

## Route Handler Patterns

### Generate and return PDF directly

```typescript
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { html, css, title } = req.body

    const pdfBuffer = await generatePDFFromHTML({
      title: title ?? 'Generated Document',
      html,
      css,
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${title ?? 'document'}.pdf"`)
    res.send(pdfBuffer)
  } catch (error) {
    console.error('PDF generation failed:', error)
    res.status(500).json({ error: 'Failed to generate PDF' })
  }
})
```

### Generate from a server-side template (e.g., EJS, Handlebars)

```typescript
import { renderToString } from './template-engine' // your template renderer

app.post('/api/invoices/:invoiceId/pdf', async (req, res) => {
  try {
    const invoice = await db.invoices.findOne({ id: req.params.invoiceId })

    // Render your template to HTML string
    const html = renderToString('invoice-template', { invoice })
    const css = fs.readFileSync('./templates/invoice.css', 'utf-8')

    const pdfBuffer = await generatePDFFromHTML({
      title: `Invoice ${invoice.number}`,
      html,
      css,
      page: { margin: '0.75in' },
    })

    // Option 1: Return directly to user
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.number}.pdf"`)
    res.send(pdfBuffer)

    // Option 2: Store in blob storage
    // --- Developer: store in your preferred storage (S3, GCS, Azure Blob, etc.) ---
    // const key = `invoices/${invoice.number}.pdf`
    // await s3Client.send(new PutObjectCommand({
    //   Bucket: process.env.DOCUMENTS_BUCKET,
    //   Key: key,
    //   Body: pdfBuffer,
    //   ContentType: 'application/pdf',
    // }))
    // await db.documentRecords.create({ invoiceId: invoice.id, storageKey: key, ... })
  } catch (error) {
    console.error('Invoice PDF generation failed:', error)
    res.status(500).json({ error: 'Failed to generate invoice PDF' })
  }
})
```

### Generate a structured report using Markdown mode

```typescript
app.get('/api/reports/:reportId/pdf', async (req, res) => {
  try {
    const report = await db.reports.findOne({ id: req.params.reportId })

    const pdfBuffer = await generatePDFFromMarkdown({
      title: report.title,
      fontFamily: 'Roboto',
      data: [
        { heading: report.title },
        { content: report.summary, fontSize: 12 },
        { label: 'Generated', content: new Date().toLocaleDateString() },
        {
          table: {
            rows: [
              ['Metric', 'Value', 'Change'],
              ...report.metrics.map((m: any) => [m.name, m.value, m.change]),
            ],
            firstRowHeaders: true,
            rowGridlines: true,
            columnOptions: [
              { width: '40%', align: 'left' },
              { width: '30%', align: 'right' },
              { width: '30%', align: 'right' },
            ],
          },
        },
      ],
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${report.title}.pdf"`)
    res.send(pdfBuffer)
  } catch (error) {
    console.error('Report PDF generation failed:', error)
    res.status(500).json({ error: 'Failed to generate report PDF' })
  }
})
```

## Using React to Generate PDFs

A common pattern is rendering a React component to an HTML string server-side, then sending that to Anvil. This lets you use your existing component library and design system for PDF layout.

```typescript
import { renderToStaticMarkup } from 'react-dom/server'
import { InvoiceTemplate } from './components/InvoiceTemplate'

export async function generateInvoicePDF(invoiceData: any) {
  // Render React component to HTML string
  const html = renderToStaticMarkup(<InvoiceTemplate invoice={invoiceData} />)

  // Include your CSS — inline styles also work
  const css = `
    body { font-family: 'Helvetica', sans-serif; color: #333; }
    .invoice-header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .line-items table { width: 100%; border-collapse: collapse; }
    .line-items td, .line-items th { padding: 8px; border-bottom: 1px solid #eee; }
    .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; }
  `

  return generatePDFFromHTML({
    title: `Invoice ${invoiceData.number}`,
    html,
    css,
    page: { margin: '0.75in' },
  })
}
```

This pattern also works with Vue (`renderToString`), Svelte, or any framework that supports server-side rendering to HTML strings.

## Performance Tips

- **Images are the bottleneck.** If your HTML references external images, PDF generation can't finish faster than the slowest image download. Use base64-encoded inline images for critical assets, or host images on a fast CDN.
- **Keep CSS simple.** Complex layouts with many nested flexbox/grid containers may increase generation time.
- **Cache generated PDFs.** If the same document is requested frequently, generate once and store in your blob store rather than regenerating each time.

## Custom Fonts

Anvil supports custom fonts in both HTML and Markdown modes. For HTML mode, use `@font-face` in your CSS with a publicly accessible font URL. For Markdown mode, set the `fontFamily` field in the payload — Anvil supports common web fonts.

## Key Points

- No template needed — layout comes from your HTML/CSS or Markdown data
- Two modes: `type: 'html'` for full control, `type: 'markdown'` for structured data
- The response is a raw PDF buffer — stream it to the user or store in a blob store (S3, GCS, etc.). Always ask the developer where they want generated PDFs stored
- Default page size is US Letter (8.5" × 11") — configurable via the `page` object
- Development API keys watermark the output; production keys require a credit card on file
- The Anvil client handles rate limiting automatically
- Works with any frontend framework that outputs HTML strings (React, Vue, Handlebars, EJS, etc.)
