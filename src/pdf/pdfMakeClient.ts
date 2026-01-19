import pdfMakeBase from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

type PdfMakeWithVfs = typeof pdfMakeBase & {
  vfs?: unknown
  addVirtualFileSystem?: (vfs: unknown) => void
  addFontContainer?: (container: unknown) => void
}

// pdfmake shippea fonts prebuild; necesitamos registrar VFS + fonts una sola vez.
const pdfMake = pdfMakeBase as PdfMakeWithVfs
const fonts = pdfFonts as unknown as { pdfMake?: { vfs?: unknown; fonts?: unknown } }

if (fonts.pdfMake) {
  if (typeof pdfMake.addFontContainer === 'function') {
    pdfMake.addFontContainer(fonts.pdfMake)
  } else if (typeof pdfMake.addVirtualFileSystem === 'function' && fonts.pdfMake.vfs) {
    pdfMake.addVirtualFileSystem(fonts.pdfMake.vfs as Record<string, string>)
  }

  if (!pdfMake.vfs && fonts.pdfMake.vfs) {
    pdfMake.vfs = fonts.pdfMake.vfs as Record<string, string>
  }
}

export { pdfMake }
