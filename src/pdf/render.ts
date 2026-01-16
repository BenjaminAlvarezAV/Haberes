import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { pdfMake } from './pdfMakeClient'

export async function createPdfBlobUrl(doc: TDocumentDefinitions): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).getBlob((b: Blob) => resolve(b))
    } catch (e) {
      reject(e)
    }
  })
  return URL.createObjectURL(blob)
}

export function downloadPdf(doc: TDocumentDefinitions, filename: string): void {
  pdfMake.createPdf(doc).download(filename)
}
