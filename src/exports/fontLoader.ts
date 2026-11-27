import type { jsPDF } from 'jspdf';

export const PDF_FONT_FAMILY = 'DejaVuSans';

interface LoadedFontPair {
  regularBase64: string;
  boldBase64: string;
}

let cachedFontsPromise: Promise<LoadedFontPair> | null = null;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Loads a binary .ttf font from `/fonts/<fileName>` on demand (precached offline by Service Worker)
 * instead of bundling ~2 MB of inline Base64 JavaScript chunks.
 * Includes a local filesystem fallback when running under Node / Vitest without an HTTP server.
 */
async function fetchStaticFontBase64(fileName: string): Promise<string> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fsModule = await import(/* @vite-ignore */ 'node:fs/promises');
      const pathModule = await import(/* @vite-ignore */ 'node:path');
      const publicFontPath = pathModule.resolve(process.cwd(), 'public', 'fonts', fileName);
      try {
        const buffer = await fsModule.readFile(publicFontPath);
        return Buffer.from(buffer).toString('base64');
      } catch {
        const nodeModPath = pathModule.resolve(
          process.cwd(),
          'node_modules',
          'dejavu-fonts-ttf',
          'ttf',
          fileName
        );
        const buffer = await fsModule.readFile(nodeModPath);
        return Buffer.from(buffer).toString('base64');
      }
    } catch {
      // Fall through to browser fetch
    }
  }

  if (typeof fetch === 'function') {
    const baseUrl =
      typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
        ? import.meta.env.BASE_URL.replace(/\/$/, '')
        : '';
    const res = await fetch(`${baseUrl}/fonts/${fileName}`, { cache: 'force-cache' });
    if (!res.ok) {
      throw new Error(`Échec du chargement de la police PDF ${fileName} (HTTP ${res.status}).`);
    }
    const buf = await res.arrayBuffer();
    return uint8ArrayToBase64(new Uint8Array(buf));
  }

  throw new Error(`Impossible de charger la police PDF hors-ligne : ${fileName}`);
}

export async function loadPdfFontPair(): Promise<LoadedFontPair> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = Promise.all([
      fetchStaticFontBase64('DejaVuSans.ttf'),
      fetchStaticFontBase64('DejaVuSans-Bold.ttf'),
    ])
      .then(([regularBase64, boldBase64]) => ({
        regularBase64,
        boldBase64,
      }))
      .catch((err) => {
        // Reset promise so a transient offline error can retry
        cachedFontsPromise = null;
        throw err;
      });
  }
  return cachedFontsPromise;
}

export async function registerFrenchPdfFont(doc: jsPDF): Promise<string> {
  const { regularBase64, boldBase64 } = await loadPdfFontPair();
  doc.addFileToVFS('DejaVuSans.ttf', regularBase64);
  doc.addFont('DejaVuSans.ttf', PDF_FONT_FAMILY, 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', boldBase64);
  doc.addFont('DejaVuSans-Bold.ttf', PDF_FONT_FAMILY, 'bold');
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  return PDF_FONT_FAMILY;
}
