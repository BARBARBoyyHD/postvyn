/**
 * What a file is, read from its own bytes.
 *
 * No native image library loads in `workerd` (ADR-013), so the type, the dimensions and the metadata
 * are all parsed here: header walks over a `Uint8Array`, no pixel ever decoded. That is also why the
 * functions below are scans of a segment or chunk list — CPU is the Worker's scarcest resource, and
 * the only thing this module must not do is decode an image.
 *
 * The client's claim is never evidence (`m6` design decision 2): the type comes from here, and the
 * name a file arrived under is only worth quoting in an error message.
 */

/**
 * 25 MB — the ceiling the intake door has enforced since M2 (`docs/003-ITA.md` §8 request limits).
 * Checked when a URL is minted (so an oversize upload never starts) and again when the object is
 * recorded (so a client that ignored the ceiling is refused, not stored).
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** What the platforms accept, and the only types this module will name as stored media. */
export const ACCEPTED_MEDIA_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;

export type MediaMime = (typeof ACCEPTED_MEDIA_MIME)[number];

/** Named as a type so a refusal can say what the file *is* rather than "unsupported". */
export const SVG_MIME = "image/svg+xml";

export type SniffedMime = MediaMime | typeof SVG_MIME;

export function isAcceptedMime(value: string): value is MediaMime {
  return (ACCEPTED_MEDIA_MIME as readonly string[]).includes(value);
}

/**
 * The magic bytes, as a table rather than an if-ladder: this *is* the list of formats the product
 * accepts, and a format is added or removed by editing one row.
 *
 * `parts` are all required, which is how a RIFF container is told from a file that merely has "WEBP"
 * at offset 8.
 */
interface MagicRule {
  mime: MediaMime;
  parts: readonly { offset: number; ascii?: string; bytes?: readonly number[] }[];
}

const MAGIC: readonly MagicRule[] = [
  { mime: "image/png", parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { mime: "image/jpeg", parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { mime: "image/gif", parts: [{ offset: 0, ascii: "GIF8" }] },
  {
    mime: "image/webp",
    parts: [
      { offset: 0, ascii: "RIFF" },
      { offset: 8, ascii: "WEBP" },
    ],
  },
];

/** ISO base media (`ftyp` at 4 bytes): MP4 and QuickTime share the box, and the brand at 8 decides. */
const ISO_BASE_MEDIA = { boxAt: 4, box: "ftyp", brandAt: 8, quickTimeBrand: "qt  " } as const;

/**
 * Svg, refused by policy rather than by capability: it is a script container, and no target platform
 * accepts it as a photo. The prolog and comments are skipped because an SVG that starts with `<?xml`
 * is still an SVG — refusing only `<svg` at byte 0 would let the interesting half through.
 */
const SVG_PREFIX = 512;

export function sniff(bytes: Uint8Array): { mime: SniffedMime } | null {
  for (const rule of MAGIC) {
    if (rule.parts.every((part) => matches(bytes, part))) return { mime: rule.mime };
  }

  if (ascii(bytes, ISO_BASE_MEDIA.boxAt, ISO_BASE_MEDIA.box.length) === ISO_BASE_MEDIA.box) {
    const brand = ascii(bytes, ISO_BASE_MEDIA.brandAt, 4);
    return { mime: brand === ISO_BASE_MEDIA.quickTimeBrand ? "video/quicktime" : "video/mp4" };
  }

  if (looksLikeSvg(bytes)) return { mime: SVG_MIME };
  return null;
}

/**
 * The size a stored image declares in its own header. Null when this format's header is not read
 * here (video: a `moov`/`tkhd` walk is not worth it — no spec rule needs a video's pixels) or when
 * the header is malformed. A null dimension skips the aspect warning rather than guessing one.
 */
export function dimensions(
  bytes: Uint8Array,
  mime: MediaMime,
): { width: number; height: number } | null {
  try {
    switch (mime) {
      case "image/png":
        // IHDR is the first chunk by definition: 8 signature bytes, length, type, then w/h.
        return bytes.length >= 24
          ? { width: u32be(bytes, 16), height: u32be(bytes, 20) }
          : null;
      case "image/gif":
        return bytes.length >= 10 ? { width: u16le(bytes, 6), height: u16le(bytes, 8) } : null;
      case "image/jpeg":
        return jpegDimensions(bytes);
      case "image/webp":
      case "video/mp4":
      case "video/quicktime":
        return null;
      default: {
        const never: never = mime;
        throw new Error(`no dimension reader for ${String(never)}`);
      }
    }
  } catch {
    return null;
  }
}

/**
 * The bytes actually worth storing.
 *
 * EXIF is stripped before an object is ever public (design decision 3): a photo of a client's office
 * should not publish its coordinates. The formats that carry it are handled one by one, and the ones
 * that do not are returned untouched — that is a fact about the format, not an omission:
 *
 *  - JPEG: every APPn segment (APP1 is EXIF and XMP, APP13 is IPTC) and every COM comment is dropped;
 *    APP0 stays because it is the JFIF decoder hint, not user metadata.
 *  - PNG: `tEXt`, `zTXt`, `iTXt` and `eXIf` chunks are dropped. IHDR/PLTE/IDAT remain in order.
 *  - WebP: the `EXIF` and `XMP ` chunks are dropped and the RIFF container size is corrected.
 *  - GIF: has no metadata block beyond a comment extension.
 *  - MP4/MOV: metadata lives in `moov/udta` boxes; removing one means rewriting box offsets and
 *    sizes, which is re-muxing — a non-goal, and a CPU budget the Worker does not have. Videos are
 *    stored as uploaded, and the upload UI says the file is published as-is.
 */
export function stripMetadata(bytes: Uint8Array, mime: MediaMime): Uint8Array<ArrayBuffer> {
  switch (mime) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
    case "image/gif":
    case "video/mp4":
    case "video/quicktime":
      return copy(bytes);
    default: {
      const never: never = mime;
      throw new Error(`no metadata stripper for ${String(never)}`);
    }
  }
}

/** `media/<workspace>/<hash>.<ext>` — the extension follows the sniffed type, never the filename. */
export function extensionFor(mime: MediaMime): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default: {
      const never: never = mime;
      throw new Error(`no extension for ${String(never)}`);
    }
  }
}

/** The content hash: what dedupe compares, and what the object key is named after. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ── the walks ────────────────────────────────────────────────────────────────────────────────────

/**
 * JPEG is a segment list until `SOS`, after which everything is entropy-coded image data and must be
 * copied verbatim. A byte that is not a marker where one is expected means this file is malformed:
 * keeping the remainder unchanged is the safe answer, because refusing to store it is the caller's
 * decision and this function's job is only to remove what it understands.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];

    // SOS: the rest is image data, and EOI is the end of the file.
    if (marker === 0xda || marker === 0xd9) {
      keep.push(bytes.subarray(offset));
      return concat(keep);
    }
    // Standalone markers (RSTn, TEM) carry no length field.
    if (marker >= 0xd0 && marker <= 0xd7) {
      keep.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }

    const length = u16be(bytes, offset + 2);
    if (length < 2) break;
    const end = Math.min(offset + 2 + length, bytes.length);
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) keep.push(bytes.subarray(offset, end));
    offset = end;
  }

  keep.push(bytes.subarray(offset));
  return concat(keep);
}

/** PNG is a chunk list: 4-byte length, 4-byte type, data, 4-byte CRC. The CRC is not computed here. */
function stripPng(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const METADATA_CHUNKS = ["tEXt", "zTXt", "iTXt", "eXIf"];
  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    if (!METADATA_CHUNKS.includes(type)) keep.push(bytes.subarray(offset, end));
    offset = end;
  }

  keep.push(bytes.subarray(offset));
  return concat(keep);
}

/** WebP is a RIFF container: 12-byte header, then `fourcc` + size + data, padded to an even length. */
function stripWebp(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const METADATA_CHUNKS = ["EXIF", "XMP "];
  const keep: Uint8Array[] = [];
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const size = u32le(bytes, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) break;
    if (!METADATA_CHUNKS.includes(ascii(bytes, offset, 4))) keep.push(bytes.subarray(offset, end));
    offset = end;
  }

  keep.push(bytes.subarray(offset));
  const body = concat(keep);
  const out = new Uint8Array(12 + body.byteLength);
  out.set(bytes.subarray(0, 12), 0);
  out.set(body, 12);
  // RIFF's size field counts everything after itself.
  const riffSize = out.byteLength - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >> 24) & 0xff;
  return out;
}

/** Walk to the first Start-Of-Frame marker (SOF0–SOF15, minus the three that are not frames). */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return null;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
    const length = u16be(bytes, offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

// ── the small readers ───────────────────────────────────────────────────────────────────────────

function matches(
  bytes: Uint8Array,
  part: { offset: number; ascii?: string; bytes?: readonly number[] },
): boolean {
  if (part.ascii !== undefined) {
    return ascii(bytes, part.offset, part.ascii.length) === part.ascii;
  }
  const signature = part.bytes ?? [];
  if (bytes.length < part.offset + signature.length) return false;
  return signature.every((byte, index) => bytes[part.offset + index] === byte);
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.length, SVG_PREFIX))
    .replace(/^\uFEFF/, "")
    .trimStart();
  return /^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype\s+svg|<svg)/i.test(head);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  );
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>>
    0
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat([bytes]);
}
