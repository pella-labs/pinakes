# Testing PDF Generation

PDF generation is notoriously hard to test. The output is binary, complex, and varies across rendering engines.

## Text Content Verification

Extract text from the generated PDF and verify content:

```typescript
import { getDocument } from 'pdfjs-dist';

it('includes invoice details', async () => {
  const pdfBuffer = await generateInvoice(invoiceData);
  const doc = await getDocument({ data: pdfBuffer }).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  const text = textContent.items.map(item => item.str).join(' ');

  expect(text).toContain('Invoice #12345');
  expect(text).toContain('$99.99');
  expect(text).toContain('Alice Johnson');
});
```

## Page Count

```typescript
it('generates correct number of pages', async () => {
  const pdf = await generateReport(largeDataset);
  const doc = await getDocument({ data: pdf }).promise;
  expect(doc.numPages).toBe(5);
});
```

## File Size Constraints

Verify that generated PDFs don't exceed size limits, especially for email attachments.

## Visual Comparison

For pixel-perfect PDF testing, render to images and use visual comparison tools. This catches layout issues that text extraction misses.

See [[test-064]] for related image processing tests.
