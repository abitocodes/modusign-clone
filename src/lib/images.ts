import "server-only";

/**
 * Structural checks for PNG / JPEG data URLs submitted by signers (signature / image fields).
 *
 * The encoded size alone says nothing about the decoded size: a tiny 1-bit PNG can declare a
 * 20000×20000 canvas, and pdf-lib's PNG embedder decodes every pixel (and every APNG frame) into
 * RGBA buffers. The dimensions are read from the headers and bounded before anything is decoded.
 */

export const MAX_IMAGE_SIDE = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/;

function sizeError(width: number, height: number): string | null {
  if (!width || !height) return "올바른 이미지가 아닙니다.";
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    return `이미지 크기가 너무 큽니다. (최대 ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE}픽셀)`;
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function checkPng(b: Buffer): string | null {
  if (b.length < 8 + 25 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return "올바른 이미지가 아닙니다.";
  let offset = 8;
  let first = true;
  while (offset + 12 <= b.length) {
    const length = b.readUInt32BE(offset);
    const type = b.toString("latin1", offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > b.length) return "올바른 이미지가 아닙니다."; // truncated chunk list
    if (first) {
      if (type !== "IHDR" || length !== 13) return "올바른 이미지가 아닙니다.";
      const width = b.readUInt32BE(offset + 8);
      const height = b.readUInt32BE(offset + 12);
      const bitDepth = b[offset + 16];
      const err = sizeError(width, height);
      if (err) return err;
      if (bitDepth > 8) return "지원하지 않는 이미지 형식입니다. (16비트 PNG)";
      first = false;
    } else if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      return "움직이는 이미지(APNG)는 사용할 수 없습니다.";
    } else if (type === "IEND") {
      return null;
    }
    offset = next;
  }
  return "올바른 이미지가 아닙니다."; // no IEND
}

function checkJpeg(b: Buffer): string | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return "올바른 이미지가 아닙니다.";
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return "올바른 이미지가 아닙니다.";
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1];
    }
    // standalone markers (no length)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan before any frame header
    if (i + 3 >= b.length) break;
    const length = b.readUInt16BE(i + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) break;
      return sizeError(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    i += 2 + length;
  }
  return "올바른 이미지가 아닙니다.";
}

/** null when the data URL is an acceptable PNG / JPEG, otherwise the error message. */
export function checkImageDataUrl(dataUrl: string): string | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return "올바른 이미지가 아닙니다.";
  const bytes = Buffer.from(m[2], "base64");
  if (bytes[0] === 0x89) return checkPng(bytes);
  if (bytes[0] === 0xff) return checkJpeg(bytes);
  return "올바른 이미지가 아닙니다.";
}
