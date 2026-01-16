import pdfMakeBase from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

// pdfmake shippea fonts prebuild; necesitamos setear vfs una sola vez.
const pdfMake = pdfMakeBase as typeof pdfMakeBase & { vfs: unknown }
const fonts = pdfFonts as unknown as { pdfMake?: { vfs?: unknown } }

if (!pdfMake.vfs && fonts.pdfMake?.vfs) {
  pdfMake.vfs = fonts.pdfMake.vfs
}

export { pdfMake }
