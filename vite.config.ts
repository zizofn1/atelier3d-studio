import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Build-time Offline PWA plugin: injects a content-hashed CACHE_NAME and the exact list
 * of generated JS/CSS chunks, PBR textures, HDRI, TTF fonts & PNG icons into `dist/sw.js`.
 */
function atelierOfflinePwaPlugin(): Plugin {
  let outDir = 'dist';

  const walkFiles = (dir: string, rootDir: string, acc: string[] = []): string[] => {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full, rootDir, acc);
      } else if (entry.isFile()) {
        const rel = '/' + path.relative(rootDir, full).replace(/\\/g, '/');
        acc.push(rel);
      }
    }
    return acc;
  };

  return {
    name: 'atelier3d-offline-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const allFiles = walkFiles(outDir, outDir)
        .filter((u) => u !== '/sw.js' && u !== '/_headers' && !u.endsWith('.map'))
        .sort();

      const precacheList = Array.from(new Set(['/', ...allFiles]));
      const hash = crypto
        .createHash('sha256')
        .update(precacheList.join('\n'))
        .digest('hex')
        .slice(0, 10);

      let swSource = fs.readFileSync(swPath, 'utf8');
      swSource = swSource.replace(
        "const CACHE_NAME = 'atelier3d-pwa-v1';",
        `const CACHE_NAME = 'atelier3d-pwa-${hash}';`
      );
      swSource = swSource.replace(
        /const PRECACHE_URLS = \[[\s\S]*?\];/,
        `const PRECACHE_URLS = ${JSON.stringify(precacheList, null, 2)};`
      );
      fs.writeFileSync(swPath, swSource, 'utf8');
    },
  };
}

const emptyOptionalDepPath = fileURLToPath(
  new URL('./src/utils/emptyOptionalDep.ts', import.meta.url)
);

export default defineConfig({
  plugins: [react(), tailwindcss(), atelierOfflinePwaPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      html2canvas: emptyOptionalDepPath,
      canvg: emptyOptionalDepPath,
      dompurify: emptyOptionalDepPath,
    },
  },
});
