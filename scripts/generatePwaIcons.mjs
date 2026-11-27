import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Precompute CRC32 table for standard PNG chunk encoding
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typeStr, dataBuf) {
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Prepend filter byte 0 (None) per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 0;
    rgba.copy(raw, rowOut + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Point-in-convex-polygon helper for anti-aliased isometric 3D cabinet emblem
function pointInPoly(px, py, pts) {
  let inside = true;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (cross < 0) {
      inside = false;
      break;
    }
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function renderAtelierIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;

  // Isometric 3D cabinet cube vertices normalized around center
  const r = size * 0.30;
  const vy = cy - size * 0.01;
  const dx = r * 0.866;
  const dy = r * 0.5;

  const pTop = [cx, vy - r];
  const pRight = [cx + dx, vy - dy];
  const pCenter = [cx, vy];
  const pLeft = [cx - dx, vy - dy];
  const pBotRight = [cx + dx, vy + dy];
  const pBot = [cx, vy + r];
  const pBotLeft = [cx - dx, vy + dy];

  // Clockwise polygons in screen space (y down -> cross > 0 is clockwise)
  const polyTop = [pTop, pRight, pCenter, pLeft];
  const polyLeft = [pLeft, pCenter, pBot, pBotLeft];
  const polyRight = [pCenter, pRight, pBotRight, pBot];

  const cornerR = size * 0.18;
  const halfInner = size / 2 - cornerR;
  const borderPad = size * 0.065;
  const jointW = Math.max(1.2, size * 0.014);

  // 2x2 supersampling for crisp edges
  const samples = [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;

      for (const [ox, oy] of samples) {
        const sx = x + 0.5 + ox;
        const sy = y + 0.5 + oy;

        // Rounded squircle SDF for subtle inner amber ring
        const qx = Math.max(0, Math.abs(sx - cx) - (halfInner - borderPad));
        const qy = Math.max(0, Math.abs(sy - cy) - (halfInner - borderPad));
        const innerDist = Math.hypot(qx, qy) - cornerR;

        // Base dark slate gradient (#0b111e -> #162136)
        const gradT = sy / size;
        let cr = 13 + (1 - gradT) * 10;
        let cg = 20 + (1 - gradT) * 14;
        let cb = 36 + (1 - gradT) * 20;

        // Subtle architectural amber frame border
        if (Math.abs(innerDist) < size * 0.012) {
          cr = 245 * 0.55 + cr * 0.45;
          cg = 158 * 0.55 + cg * 0.45;
          cb = 11 * 0.55 + cb * 0.45;
        }

        // Isometric 3D cabinet faces
        if (pointInPoly(sx, sy, polyTop)) {
          // Warm sunlit top countertop (#fde68a)
          cr = 253;
          cg = 230;
          cb = 138;
        } else if (pointInPoly(sx, sy, polyLeft)) {
          // Signature Atelier3D amber facade (#f59e0b)
          cr = 245;
          cg = 158;
          cb = 11;
          // Vertical double-door reveal seam down the left facade
          const midTopX = (pLeft[0] + pCenter[0]) / 2;
          const midTopY = (pLeft[1] + pCenter[1]) / 2;
          const midBotX = (pBotLeft[0] + pBot[0]) / 2;
          const midBotY = (pBotLeft[1] + pBot[1]) / 2;
          if (distToSegment(sx, sy, midTopX, midTopY, midBotX, midBotY) < jointW * 0.75) {
            cr = 15;
            cg = 23;
            cb = 42;
          }
        } else if (pointInPoly(sx, sy, polyRight)) {
          // Deep shaded oak/bronze side carcass (#b45309)
          cr = 180;
          cg = 83;
          cb = 9;
          // Horizontal drawer reveal lines on right side
          for (const t of [0.34, 0.67]) {
            const lx1 = pCenter[0] + (pBot[0] - pCenter[0]) * t;
            const ly1 = pCenter[1] + (pBot[1] - pCenter[1]) * t;
            const lx2 = pRight[0] + (pBotRight[0] - pRight[0]) * t;
            const ly2 = pRight[1] + (pBotRight[1] - pRight[1]) * t;
            if (distToSegment(sx, sy, lx1, ly1, lx2, ly2) < jointW * 0.7) {
              cr = 15;
              cg = 23;
              cb = 42;
            }
          }
        }

        // Crisp dark architectural joint lines along primary cube creases
        if (
          distToSegment(sx, sy, pCenter[0], pCenter[1], pLeft[0], pLeft[1]) < jointW * 0.85 ||
          distToSegment(sx, sy, pCenter[0], pCenter[1], pRight[0], pRight[1]) < jointW * 0.85 ||
          distToSegment(sx, sy, pCenter[0], pCenter[1], pBot[0], pBot[1]) < jointW * 0.85
        ) {
          cr = 15;
          cg = 23;
          cb = 42;
        }

        accR += cr;
        accG += cg;
        accB += cb;
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(accR / 4);
      rgba[idx + 1] = Math.round(accG / 4);
      rgba[idx + 2] = Math.round(accB / 4);
      rgba[idx + 3] = 255; // Opaque full-bleed square (ideal for both iOS apple-touch-icon & maskable PWA)
    }
  }

  return encodePngRgba(size, size, rgba);
}

const outDir = path.resolve(process.cwd(), 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'apple-touch-icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

for (const t of targets) {
  const buf = renderAtelierIcon(t.size);
  const fullPath = path.join(outDir, t.name);
  fs.writeFileSync(fullPath, buf);
  console.log(`Generated ${t.name} (${t.size}x${t.size}, ${buf.length} bytes)`);
}
