import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

// Two window outlines and a right arrow, rasterized at 4x for small toolbar sizes.
function pixel(x, y) {
  const rect = (left, top, right, bottom) => x >= left && x < right && y >= top && y < bottom;
  const frame = (left, top, right, bottom) => rect(left, top, right, bottom) && !rect(left + 5, top + 8, right - 5, bottom - 5);
  if (frame(17, 23, 72, 77) || frame(56, 52, 111, 106)) return [245, 249, 246, 255];
  if (rect(35, 83, 68, 89) || (x >= 60 && x < 77 && Math.abs(y - 86) < 77 - x)) return [180, 223, 195, 255];
  if (rect(5, 5, 123, 123)) return [36, 91, 70, 255];
  return [0, 0, 0, 0];
}

function chunk(name, data) {
  const type = Buffer.from(name);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}

mkdirSync(new URL("../extension/icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgba = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      pixel((x + (sx + .5) / 4) * 128 / size, (y + (sy + .5) / 4) * 128 / size).forEach((value, channel) => { rgba[channel] += value / 16; });
    }
    rgba.forEach((value, channel) => { scanlines[y * (size * 4 + 1) + 1 + x * 4 + channel] = Math.round(value); });
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(new URL(`../extension/icons/${size}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0)),
  ]));
}
