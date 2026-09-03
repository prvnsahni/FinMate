/**
 * Minimal pdfjs-dist loader (DOC-3). pdfjs-dist v6 is ESM-only; the backend/tests
 * transpile to CommonJS, which would downlevel `import()` to `require()` and fail on
 * an ESM-only package. The `Function` constructor hides the dynamic import from the
 * transpiler so Node's NATIVE `import()` is used at runtime (prod + Jest). No network:
 * pdfjs text extraction is fully local and needs no canvas.
 */

/** Narrow subset of the pdfjs API this spike uses (avoids `any`). */
export interface PdfTextItem {
  str: string;
}
export interface PdfTextContent {
  items: PdfTextItem[];
}
export interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
}
export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}
export interface PdfDocumentLoadingTask {
  promise: Promise<PdfDocument>;
}
export interface PdfjsModule {
  getDocument(src: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): PdfDocumentLoadingTask;
}

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

let cached: Promise<PdfjsModule> | null = null;

/** Load the pdfjs module once (cached), via native ESM import. */
export function loadPdfjs(): Promise<PdfjsModule> {
  if (!cached) {
    cached = nativeImport('pdfjs-dist/legacy/build/pdf.mjs').then(
      (mod) => mod as PdfjsModule,
    );
  }
  return cached;
}
