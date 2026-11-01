import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

// 1. Helper to generate a valid PNG buffer without external native dependencies
function createPNG(width, height, getPixel) {
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    let crc = 0xffffffff;
    for (const b of Buffer.concat([typeBuf, data])) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// 2. Helper to wrap a PNG inside an ICO container
function createICOFromPNG(pngBuffer, width, height) {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // count: 1 image

  const directoryEntry = Buffer.alloc(16);
  directoryEntry.writeUInt8(width === 256 ? 0 : width, 0);
  directoryEntry.writeUInt8(height === 256 ? 0 : height, 1);
  directoryEntry.writeUInt8(0, 2); // color palette: 0 = no palette
  directoryEntry.writeUInt8(0, 3); // reserved
  directoryEntry.writeUInt16LE(1, 4); // color planes
  directoryEntry.writeUInt16LE(32, 6); // bits per pixel
  directoryEntry.writeUInt32LE(pngBuffer.length, 8); // size of image data
  directoryEntry.writeUInt32LE(6 + 16, 12); // offset to image data

  return Buffer.concat([icoHeader, directoryEntry, pngBuffer]);
}

// 3. Pixel renderer for F Share icon (gradient background + white stylized 'F' with nodes)
function renderFIconPixel(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Rounded rectangle boundary
  const cornerR = 0.22;
  let inBounds = true;
  if (nx < cornerR && ny < cornerR) {
    const dx = nx - cornerR, dy = ny - cornerR;
    if (dx * dx + dy * dy > cornerR * cornerR) inBounds = false;
  } else if (nx > 1 - cornerR && ny < cornerR) {
    const dx = nx - (1 - cornerR), dy = ny - cornerR;
    if (dx * dx + dy * dy > cornerR * cornerR) inBounds = false;
  } else if (nx < cornerR && ny > 1 - cornerR) {
    const dx = nx - cornerR, dy = ny - (1 - cornerR);
    if (dx * dx + dy * dy > cornerR * cornerR) inBounds = false;
  } else if (nx > 1 - cornerR && ny > 1 - cornerR) {
    const dx = nx - (1 - cornerR), dy = ny - (1 - cornerR);
    if (dx * dx + dy * dy > cornerR * cornerR) inBounds = false;
  }

  if (!inBounds) return [0, 0, 0, 0];

  // Gradient: Indigo (#4f46e5 = 79, 70, 229) to Violet (#7c3aed = 124, 58, 237)
  const gradT = (nx + ny) / 2;
  const bgR = Math.round(79 + (124 - 79) * gradT);
  const bgG = Math.round(70 + (58 - 70) * gradT);
  const bgB = Math.round(229 + (237 - 229) * gradT);

  // Stylized 'F' drawing:
  // Stem: x from 0.25 to 0.38, y from 0.22 to 0.78
  const inStem = (nx >= 0.26 && nx <= 0.38 && ny >= 0.22 && ny <= 0.78);
  // Top bar: x from 0.38 to 0.70, y from 0.22 to 0.34
  const inTopBar = (nx >= 0.38 && nx <= 0.70 && ny >= 0.22 && ny <= 0.34);
  // Middle bar: x from 0.38 to 0.58, y from 0.44 to 0.54
  const inMidBar = (nx >= 0.38 && nx <= 0.58 && ny >= 0.44 && ny <= 0.54);

  // Node dots at top bar end, mid bar end, and stem bottom
  const dTopDot = Math.hypot(nx - 0.70, ny - 0.28);
  const dMidDot = Math.hypot(nx - 0.58, ny - 0.49);
  const dBotDot = Math.hypot(nx - 0.32, ny - 0.78);
  const inNode = (dTopDot <= 0.09 || dMidDot <= 0.08 || dBotDot <= 0.07);

  if (inStem || inTopBar || inMidBar || inNode) {
    return [255, 255, 255, 255]; // Crisp white mark
  }

  return [bgR, bgG, bgB, 255];
}

// 4. Pixel renderer for Open Graph card (1200x630 dark slate banner with gradient glow)
function renderOGPixel(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;
  // Deep slate background (#0f172a = 15, 23, 42)
  let r = 15;
  let g = 23;
  let b = 42;

  // Radial glow on top-left (#4f46e5)
  const dGlow = Math.hypot(nx - 0.3, ny - 0.4);
  const glow = Math.max(0, 1 - dGlow * 1.6);
  r = Math.min(255, Math.round(r + glow * 50));
  g = Math.min(255, Math.round(g + glow * 40));
  b = Math.min(255, Math.round(b + glow * 120));

  // Center logo square at (nx: 0.18 to 0.30, ny: 0.30 to 0.55)
  if (nx >= 0.16 && nx <= 0.32 && ny >= 0.25 && ny <= 0.55) {
    const lx = (nx - 0.16) / (0.32 - 0.16);
    const ly = (ny - 0.25) / (0.55 - 0.25);
    const [lr, lg, lb, la] = renderFIconPixel(lx * 100, ly * 100, 100, 100);
    if (la > 0) {
      return [lr, lg, lb, 255];
    }
  }

  return [r, g, b, 255];
}

// Generate files:
console.log('Generating F Share brand and SEO assets...');

// 1. favicon.svg
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="fshare-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#fshare-grad)" />
  <path d="M20 18h24M20 32h16M20 18v28" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="44" cy="18" r="4.5" fill="#ffffff" />
  <circle cx="36" cy="32" r="4" fill="#ffffff" />
  <circle cx="20" cy="46" r="3.5" fill="#ffffff" />
</svg>
`;
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg, 'utf8');
console.log('✅ Created public/favicon.svg');

// 2. 32x32 PNG & favicon.ico
const png32 = createPNG(32, 32, renderFIconPixel);
const icoBuffer = createICOFromPNG(png32, 32, 32);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), png32);
console.log('✅ Created public/favicon.ico & public/favicon-32x32.png');

// 3. apple-touch-icon.png (180x180)
const appleTouchPng = createPNG(180, 180, renderFIconPixel);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouchPng);
console.log('✅ Created public/apple-touch-icon.png');

// 4. og-image.png (1200x630)
const ogImagePng = createPNG(1200, 630, renderOGPixel);
fs.writeFileSync(path.join(publicDir, 'og-image.png'), ogImagePng);
console.log('✅ Created public/og-image.png');

// 5. site.webmanifest
const webmanifest = {
  name: "F Share - Fast, Simple & Secure File Sharing",
  short_name: "F Share",
  description: "Upload files, generate a share code, and let others retrieve them easily. Simple file sharing with configurable expiration and secure downloads.",
  start_url: "/",
  display: "standalone",
  background_color: "#0f172a",
  theme_color: "#4f46e5",
  icons: [
    {
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml"
    },
    {
      src: "/favicon-32x32.png",
      sizes: "32x32",
      type: "image/png"
    },
    {
      src: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png"
    }
  ]
};
fs.writeFileSync(path.join(publicDir, 'site.webmanifest'), JSON.stringify(webmanifest, null, 2), 'utf8');
console.log('✅ Created public/site.webmanifest');

