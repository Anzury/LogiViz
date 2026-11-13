// Draws the site's icon, a delivery truck on its round, and writes it to public/
// as an SVG and as PNGs for the browsers and phones that want one.
// Usage: node scripts/favicon.mjs   (from the project root)
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// The picture, one character per pixel, in the colours of the pixel-art kit (src/pixel/kit.ts).
const COLOURS = {
  R: '#c9a26b', // the board's rim
  r: '#9c7646', // its front edge
  G: '#b4c2a2', // the cutting mat
  o: '#2b2622', // outlines
  B: '#fffdf6', // the truck's box
  b: '#d2c4a8', // its shaded foot
  C: '#1f6fd6', // the cab, in the colour of the round
  L: '#c9dbe6', // the windscreen
  K: '#655c53', // the wheels
  T: '#1f6fd6', // the round itself
};
const ART = [
  '.RRRRRRRRRRRRRR.',
  'RGGGGGGGGGGGGGGR',
  'RGGGGGGGGGGGGGGR',
  'RGGGGGGGGGGGGGGR',
  'RGoooooooGGGGGGR',
  'RoBBBBBBBoGGGGGR',
  'RoBBBBBBBooooGGR',
  'RoBBBBBBBoCLLoGR',
  'RobbbbbbboCCCoGR',
  'RoooooooooooooGR',
  'RGoKKoGGGoKKoGGR',
  'RGGooGGGGGooGGGR',
  'RTTTTTTTTTTTTTTR',
  'RTTTTTTTTTTTTTTR',
  'RGGGGGGGGGGGGGGR',
  '.rrrrrrrrrrrrrr.',
];
const SIZE = ART.length;
for (const [y, row] of ART.entries()) {
  if (row.length !== SIZE) throw new Error(`row ${y} is ${row.length} wide, expected ${SIZE}`);
}

// ------------------------------------------------------------------ SVG

/** One rectangle per run of pixels of the same colour, so the file stays small and the edges sharp. */
function svg() {
  const rects = [];
  ART.forEach((row, y) => {
    for (let x = 0; x < SIZE; ) {
      let end = x + 1;
      while (end < SIZE && row[end] === row[x]) end++;
      if (row[x] !== '.') rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${COLOURS[row[x]]}"/>`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`;
}

// ------------------------------------------------------------------ PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/**
 * The picture enlarged `scale` times without smoothing, on a square `side`
 * pixels wide. With a `ground` colour the picture has no transparent pixel,
 * which is what a phone's home screen wants.
 */
function png(side, scale, ground = null) {
  const offset = Math.floor((side - SIZE * scale) / 2);
  const rows = Buffer.alloc((side * 4 + 1) * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const ax = Math.floor((x - offset) / scale);
      const ay = Math.floor((y - offset) / scale);
      const code = ART[ay]?.[ax] ?? '.';
      const hex = code === '.' ? ground : COLOURS[code];
      const at = y * (side * 4 + 1) + 1 + x * 4;
      if (!hex) continue;
      rows[at] = parseInt(hex.slice(1, 3), 16);
      rows[at + 1] = parseInt(hex.slice(3, 5), 16);
      rows[at + 2] = parseInt(hex.slice(5, 7), 16);
      rows[at + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/favicon.svg', svg());
writeFileSync('public/favicon-32.png', png(32, 2));
writeFileSync('public/apple-touch-icon.png', png(180, 10, COLOURS.R));
console.log('public/favicon.svg, public/favicon-32.png, public/apple-touch-icon.png written');
