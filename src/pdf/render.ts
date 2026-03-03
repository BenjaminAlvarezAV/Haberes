import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { pdfMake } from './pdfMakeClient'

type OutputDocument = {
  getBlob: () => Promise<Blob>
  getBuffer: () => Promise<Uint8Array>
  getBase64: () => Promise<string>
  download: (filename?: string) => Promise<void>
}

function createOutput(doc: TDocumentDefinitions): OutputDocument {
  return pdfMake.createPdf(doc) as OutputDocument
}

export async function createPdfBlob(doc: TDocumentDefinitions): Promise<Blob> {
  return createOutput(doc).getBlob()
}

export async function createPdfUint8Array(doc: TDocumentDefinitions): Promise<Uint8Array> {
  return createOutput(doc).getBuffer()
}

export async function createPdfBase64(doc: TDocumentDefinitions): Promise<string> {
  return createOutput(doc).getBase64()
}

export async function createPdfBlobUrl(doc: TDocumentDefinitions): Promise<string> {
  const blob = await createPdfBlob(doc)
  return URL.createObjectURL(blob)
}

export function downloadPdf(doc: TDocumentDefinitions, filename: string): void {
  void createOutput(doc).download(filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Dar margen para descargas grandes (ZIP), evitando revocar el URL demasiado pronto.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
