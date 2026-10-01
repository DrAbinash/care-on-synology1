/**
 * Same-origin Tesseract.js asset URLs.
 *
 * The ERP ships under a sub-path (Dockerfile BASE_PATH=/erp/) while the clinic
 * website owns "/" with an SPA fallback, so a root-absolute
 * "/tesseract/worker.min.js" does not 404 in production — it returns the
 * website's index.html with HTTP 200 and Tesseract tries to gunzip a web page.
 */
export interface TesseractAssetOptions {
  workerPath: string;
  corePath: string;
  langPath: string;
  cachePath: string;
  gzip: true;
}

export function tesseractAssetOptions(base: string): TesseractAssetOptions {
  const dir = `${base.replace(/\/?$/, "/")}tesseract`;
  return {
    workerPath: `${dir}/worker.min.js`,
    corePath: `${dir}/tesseract-core.wasm.js`,
    langPath: dir,
    cachePath: dir,
    gzip: true,
  };
}

export const TESSERACT_ASSET_OPTS = tesseractAssetOptions(import.meta.env.BASE_URL ?? "/");
