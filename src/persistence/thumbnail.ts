import type { ProjectDocument } from '@/types';

const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 160;

function computeBounds(doc: ProjectDocument): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const wall of doc.walls) {
    minX = Math.min(minX, wall.startMm[0], wall.endMm[0]);
    maxX = Math.max(maxX, wall.startMm[0], wall.endMm[0]);
    minZ = Math.min(minZ, wall.startMm[1], wall.endMm[1]);
    maxZ = Math.max(maxZ, wall.startMm[1], wall.endMm[1]);
  }

  for (const mod of doc.modules) {
    const halfW = mod.widthMm / 2;
    const halfD = mod.depthMm / 2;
    const radius = Math.hypot(halfW, halfD);
    minX = Math.min(minX, mod.xMm - radius);
    maxX = Math.max(maxX, mod.xMm + radius);
    minZ = Math.min(minZ, mod.zMm - radius);
    maxZ = Math.max(maxZ, mod.zMm + radius);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { minX: 0, maxX: 4000, minZ: 0, maxZ: 3000 };
  }

  const spanX = Math.max(maxX - minX, 500);
  const spanZ = Math.max(maxZ - minZ, 500);
  const padX = spanX * 0.12;
  const padZ = spanZ * 0.12;

  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minZ: minZ - padZ,
    maxZ: maxZ + padZ,
  };
}

function buildSvgThumbnailString(doc: ProjectDocument): string {
  const { minX, maxX, minZ, maxZ } = computeBounds(doc);
  const spanX = Math.max(maxX - minX, 1);
  const spanZ = Math.max(maxZ - minZ, 1);
  const scale = Math.min((THUMB_WIDTH - 24) / spanX, (THUMB_HEIGHT - 24) / spanZ);
  const offsetX = (THUMB_WIDTH - spanX * scale) / 2;
  const offsetY = (THUMB_HEIGHT - spanZ * scale) / 2;

  const tx = (x: number) => ((x - minX) * scale + offsetX).toFixed(1);
  const ty = (z: number) => ((z - minZ) * scale + offsetY).toFixed(1);

  const wallEls = doc.walls
    .map(
      (w) =>
        `<line x1="${tx(w.startMm[0])}" y1="${ty(w.startMm[1])}" x2="${tx(w.endMm[0])}" y2="${ty(
          w.endMm[1]
        )}" stroke="#e2e8f0" stroke-width="${Math.max(2, w.thicknessMm * scale).toFixed(
          1
        )}" stroke-linecap="square" />`
    )
    .join('');

  const modEls = doc.modules
    .map((m) => {
      const cx = (m.xMm - minX) * scale + offsetX;
      const cy = (m.zMm - minZ) * scale + offsetY;
      const w = Math.max(4, m.widthMm * scale);
      const d = Math.max(4, m.depthMm * scale);
      const deg = ((-m.rotationYRad * 180) / Math.PI).toFixed(1);
      const fill = m.type === 'ilot_central' || m.type === 'plan_de_travail' ? '#d97706' : '#c89d6c';
      return `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - d / 2).toFixed(1)}" width="${w.toFixed(
        1
      )}" height="${d.toFixed(1)}" fill="${fill}" fill-opacity="0.82" stroke="#f59e0b" stroke-width="0.8" transform="rotate(${deg} ${cx.toFixed(
        1
      )} ${cy.toFixed(1)})" />`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" viewBox="0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}"><rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="#0f172a"/>${wallEls}${modEls}</svg>`;
}

export function generateThumbnailDataUrl(
  doc: ProjectDocument,
  webglCanvas?: HTMLCanvasElement | null
): string {
  if (typeof document !== 'undefined') {
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = THUMB_WIDTH;
      offscreen.height = THUMB_HEIGHT;
      const ctx = offscreen.getContext('2d');

      if (ctx) {
        if (webglCanvas && webglCanvas.width > 0 && webglCanvas.height > 0) {
          ctx.drawImage(webglCanvas, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
          const png = offscreen.toDataURL('image/png');
          if (png && png.startsWith('data:image/')) {
            return png;
          }
        }

        // Draw 2D plan onto canvas
        const { minX, maxX, minZ, maxZ } = computeBounds(doc);
        const spanX = Math.max(maxX - minX, 1);
        const spanZ = Math.max(maxZ - minZ, 1);
        const scale = Math.min((THUMB_WIDTH - 24) / spanX, (THUMB_HEIGHT - 24) / spanZ);
        const offsetX = (THUMB_WIDTH - spanX * scale) / 2;
        const offsetY = (THUMB_HEIGHT - spanZ * scale) / 2;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineCap = 'square';
        for (const w of doc.walls) {
          ctx.lineWidth = Math.max(2, w.thicknessMm * scale);
          ctx.beginPath();
          ctx.moveTo((w.startMm[0] - minX) * scale + offsetX, (w.startMm[1] - minZ) * scale + offsetY);
          ctx.lineTo((w.endMm[0] - minX) * scale + offsetX, (w.endMm[1] - minZ) * scale + offsetY);
          ctx.stroke();
        }

        for (const m of doc.modules) {
          const cx = (m.xMm - minX) * scale + offsetX;
          const cy = (m.zMm - minZ) * scale + offsetY;
          const w = Math.max(4, m.widthMm * scale);
          const d = Math.max(4, m.depthMm * scale);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(-m.rotationYRad);
          ctx.fillStyle =
            m.type === 'ilot_central' || m.type === 'plan_de_travail'
              ? 'rgba(217, 119, 6, 0.85)'
              : 'rgba(200, 157, 108, 0.82)';
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 0.8;
          ctx.fillRect(-w / 2, -d / 2, w, d);
          ctx.strokeRect(-w / 2, -d / 2, w, d);
          ctx.restore();
        }

        const png = offscreen.toDataURL('image/png');
        if (png && png.startsWith('data:image/')) {
          return png;
        }
      }
    } catch {
      // Fall through to SVG data URL
    }
  }

  return `data:image/svg+xml;utf8,${encodeURIComponent(buildSvgThumbnailString(doc))}`;
}
