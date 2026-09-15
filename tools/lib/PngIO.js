/**
 * PngIO.js — a minimal, dependency-free PNG reader/writer for the tool
 * pipeline.
 *
 * Why this exists: Firing Range's terrain is driven by a real heightmap
 * IMAGE (assets/textures/environment/firingrange_heightmap.png) rather than
 * pure procedural noise, and the baked minimap is a real .png file. Node has
 * zlib built in but no image codec, and the project's standing policy is
 * "code-driven, real-file-producing tools, no new runtime dependencies" — so
 * the ~150 lines of PNG plumbing live here instead of pulling in a package.
 *
 * Supported on read: 8-bit and 16-bit, colour types 0 (grey), 2 (RGB),
 * 4 (grey+alpha) and 6 (RGBA), non-interlaced — which covers every PNG the
 * asset pipeline produces or consumes. Palette (type 3) and Adam7 interlace
 * are deliberately unsupported and throw a clear error rather than silently
 * decoding garbage.
 *
 * Supported on write: 8-bit RGBA, filter 0, one IDAT chunk.
 */
import zlib from 'node:zlib';
import fs from 'node:fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------- CRC32 ----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// ----------------------------------------------------------------- READ ----

const CHANNELS_FOR_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG file into { width, height, channels, depth, data } where
 * `data` is a Uint8Array/Uint16Array of interleaved samples.
 */
export function readPNG(filePath) {
  const buf = fs.readFileSync(filePath);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`PngIO: ${filePath} is not a PNG`);
  }

  let offset = 8;
  let width = 0; let height = 0; let depth = 8; let colorType = 6; let interlace = 0;
  const idatParts = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idatParts.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (interlace !== 0) throw new Error('PngIO: interlaced PNGs are not supported');
  const channels = CHANNELS_FOR_COLOR_TYPE[colorType];
  if (!channels) throw new Error(`PngIO: unsupported colour type ${colorType} (palette PNGs are not supported)`);
  if (depth !== 8 && depth !== 16) throw new Error(`PngIO: unsupported bit depth ${depth}`);

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const bytesPerSample = depth / 8;
  const bytesPerPixel = channels * bytesPerSample;
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);

  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[src + x];
      const a = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = (x >= bytesPerPixel && y > 0) ? out[prevStart + x - bytesPerPixel] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + a; break;
        case 2: value = rawByte + b; break;
        case 3: value = rawByte + ((a + b) >> 1); break;
        case 4: value = rawByte + paethPredictor(a, b, c); break;
        default: throw new Error(`PngIO: unknown row filter ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    src += stride;
  }

  let data;
  if (depth === 8) {
    data = new Uint8Array(out.buffer, out.byteOffset, out.length);
  } else {
    data = new Uint16Array(width * height * channels);
    for (let i = 0; i < data.length; i += 1) data[i] = out.readUInt16BE(i * 2);
  }
  return { width, height, channels, depth, data };
}

/**
 * Decode a PNG into a normalised [0..1] single-channel luminance grid —
 * the exact shape a heightmap sampler wants.
 */
export function readHeightmapGrid(filePath) {
  const img = readPNG(filePath);
  const max = img.depth === 16 ? 65535 : 255;
  const grid = new Float32Array(img.width * img.height);
  for (let i = 0; i < grid.length; i += 1) {
    const base = i * img.channels;
    // Rec.709 luma when the source is colour; straight value when it's grey.
    const value = img.channels >= 3
      ? img.data[base] * 0.2126 + img.data[base + 1] * 0.7152 + img.data[base + 2] * 0.0722
      : img.data[base];
    grid[i] = value / max;
  }
  return { width: img.width, height: img.height, grid };
}

// ---------------------------------------------------------------- WRITE ----

/** Encode 8-bit RGBA samples (length = width*height*4) as a real .png file. */
export function writePNG(filePath, width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
  return png.length;
}

export default { readPNG, readHeightmapGrid, writePNG };
