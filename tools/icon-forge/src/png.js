const fs = require('fs');
const zlib = require('zlib');

function decodePng(buffer) {
  const W = buffer.readUInt32BE(16);
  const H = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];

  let p = 8;
  const idat = [];
  while (p < buffer.length) {
    const len = buffer.readUInt32BE(p);
    const type = buffer.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buffer.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = W * channels;
  let prev = Buffer.alloc(stride);
  const px = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < W; x++) {
      const s = x * channels;
      const d = (y * W + x) * 4;
      px[d] = line[s];
      px[d + 1] = channels >= 2 ? line[s + 1] : line[s];
      px[d + 2] = channels >= 3 ? line[s + 2] : line[s];
      px[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { W, H, px };
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { decodePng, encodePng };
