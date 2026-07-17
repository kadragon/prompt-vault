// Ambient module declarations for non-standard imports the bundler resolves.

// Vite `?inline` returns the asset as a base64 `data:` URL string (default export).
// Used to embed the PDF font (src/export/fonts/jetendard.ts).
declare module '*.ttf?inline' {
  const dataUrl: string;
  export default dataUrl;
}

// pdfmake's browser build. @types/pdfmake types the root `pdfmake` module but not
// this build subpath, so mirror the browser API surface we use. The default export
// is the pdfMake object (createPdf + the browser vfs/font registration helpers).
declare module 'pdfmake/build/pdfmake' {
  import type {
    TCreatedPdf,
    TDocumentDefinitions,
    TFontDictionary,
    TVirtualFileSystem,
  } from 'pdfmake/interfaces';

  const pdfMake: {
    createPdf(documentDefinitions: TDocumentDefinitions): TCreatedPdf;
    addVirtualFileSystem(vfs: TVirtualFileSystem): void;
    addFonts(fonts: TFontDictionary): void;
  };
  export default pdfMake;
}
