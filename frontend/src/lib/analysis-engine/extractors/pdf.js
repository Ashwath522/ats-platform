/** Extract factual PDF text and metadata in the worker. */
export async function extract({ file, name }) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const meta = await pdf.getMetadata().catch(() => ({ info: {} }))
  const evidence = [{ id: `client_${crypto.randomUUID()}`, source_type: 'file', source_ref: name, locator: null, fact: `${name}: ${pdf.numPages} pages${meta.info?.Title ? `; title: ${String(meta.info.Title).slice(0, 180)}` : ''}`, method: 'parsed', confidence: 'high', origin: 'client' }]
  const warnings = []
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n); const content = await page.getTextContent(); const text = content.items.map((x) => x.str).join(' ').trim()
    if (!text) { warnings.push(`page ${n} looks scanned — text not read`); continue }
    evidence.push({ id: `client_${crypto.randomUUID()}`, source_type: 'file', source_ref: name, locator: { page: n }, fact: `${name} page ${n}: ${text.slice(0, 450)}`, method: 'parsed', confidence: 'high', origin: 'client' })
  }
  return { evidence, warnings }
}
