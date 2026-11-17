/**
 * The pure half of the upload path: what a file is, what it measures, what metadata it carried, and
 * where its key points.
 *
 * These are unit tests on purpose. Type detection, an EXIF strip and a dimension read are the parts
 * that are wrong silently — a sniffed PNG that is really a JPEG is a post that fails at the platform,
 * and a GPS tag that survived is a client's address on the internet — so they are proven against
 * hand-built headers rather than against a bucket.
 */
import { describe, expect, it } from "vitest";

import { objectKey, publicMediaUrl } from "@/lib/media/address";
import {
  MAX_UPLOAD_BYTES,
  dimensions,
  extensionFor,
  isAcceptedMime,
  sha256Hex,
  sniff,
  stripMetadata,
} from "@/lib/media/bytes";
import { UPLOAD_URL_TTL_SECONDS, presignPut } from "@/lib/media/r2-presign";

/** A 1×1 PNG: real signature and IHDR, real IDAT, enough for the sniffer and the dimension reader. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
  0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * SOI, an APP1 carrying `Exif` + a (tiny, illustrative) TIFF header, SOF0 at 32×16, SOS and an EOI.
 * The point is the segment shape, not the EXIF payload: a strip that removes APP1 is a strip that
 * removes GPS, whichever tag inside it held the coordinates.
 */
const JPEG_WITH_EXIF = new Uint8Array([
  0xff, 0xd8,
  // APP1: length 16 (incl. the length bytes), "Exif\0\0", big-endian TIFF header
  0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00,
  0x00, 0x08,
  // SOF0: length 17, precision 8, height 16, width 32, three components
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01,
  0x03, 0x11, 0x01,
  // SOS, then entropy-coded data that must survive verbatim, then EOI
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

function asciiBytes(value: string): number[] {
  return [...value].map((character) => character.charCodeAt(0));
}

/** The same PNG with a `tEXt` chunk after IHDR — the "Comment" a screenshot tool likes to leave. */
const PNG_WITH_TEXT = new Uint8Array([
  ...PNG.subarray(0, 33),
  0x00, 0x00, 0x00, 0x0a, // chunk length 10
  ...asciiBytes("tEXt"),
  ...asciiBytes("Comment"),
  0x00,
  ...asciiBytes("hi"),
  0x00, 0x00, 0x00, 0x00, // CRC: this module does not verify it, and a test fixture does not need one
  ...PNG.subarray(33),
]);

/** RIFF/WEBP with a VP8X chunk and an EXIF chunk: 42 bytes of nothing, wrapped correctly. */
const WEBP_WITH_EXIF = new Uint8Array([
  ...asciiBytes("RIFF"),
  0x22, 0x00, 0x00, 0x00, // file size - 8
  ...asciiBytes("WEBP"),
  ...asciiBytes("VP8X"),
  0x0a, 0x00, 0x00, 0x00,
  ...new Array<number>(10).fill(0),
  ...asciiBytes("EXIF"),
  0x04, 0x00, 0x00, 0x00,
  0x45, 0x78, 0x69, 0x66,
]);

describe("the sniffer trusts bytes, not names", () => {
  const cases: [string, Uint8Array, string | null][] = [
    ["png", PNG, "image/png"],
    ["jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["gif", new TextEncoder().encode("GIF89a"), "image/gif"],
    ["webp", new TextEncoder().encode("RIFF....WEBP"), "image/webp"],
    ["mp4", new TextEncoder().encode("\0\0\0\x18ftypisom"), "video/mp4"],
    ["mov", new TextEncoder().encode("\0\0\0\x18ftypqt  "), "video/quicktime"],
    ["svg", new TextEncoder().encode("<svg xmlns="), "image/svg+xml"],
    // An SVG that starts with a prolog is still an SVG; refusing only `<svg` at byte 0 lets it through.
    ["svg with a prolog", new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns='), "image/svg+xml"],
    ["executable", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), null],
    ["empty", new Uint8Array([]), null],
  ];

  for (const [name, bytes, expected] of cases) {
    it(`${name} → ${expected ?? "refused"}`, () => {
      expect(sniff(bytes)?.mime ?? null).toBe(expected);
    });
  }

  it("accepts exactly the six types the platforms take", () => {
    expect(isAcceptedMime("image/png")).toBe(true);
    expect(isAcceptedMime("video/quicktime")).toBe(true);
    expect(isAcceptedMime("image/svg+xml")).toBe(false);
    expect(isAcceptedMime("application/pdf")).toBe(false);
  });
});

describe("metadata is stripped, and the image still reads", () => {
  it("drops a JPEG's APP1 segment and keeps the frame header", () => {
    const stripped = stripMetadata(JPEG_WITH_EXIF, "image/jpeg");

    // The whole APP1 segment goes: marker, length word and payload (2 + 16).
    expect(stripped.byteLength).toBe(JPEG_WITH_EXIF.byteLength - 18);
    expect(new TextDecoder().decode(stripped)).not.toContain("Exif");
    expect(dimensions(stripped, "image/jpeg")).toEqual({ width: 32, height: 16 });
    // The entropy-coded tail is not parsed, so it must arrive unchanged.
    expect([...stripped.subarray(-4)]).toEqual([0x12, 0x34, 0xff, 0xd9]);
  });

  it("drops a PNG's tEXt chunk and keeps the pixels", () => {
    const stripped = stripMetadata(PNG_WITH_TEXT, "image/png");

    expect(stripped.byteLength).toBe(PNG_WITH_TEXT.byteLength - 22);
    expect(dimensions(stripped, "image/png")).toEqual({ width: 1, height: 1 });
    // IDAT survived: the byte right after IHDR is still the IDAT length.
    expect(String.fromCharCode(...stripped.subarray(37, 41))).toBe("IDAT");
  });

  it("drops a WebP's EXIF chunk and corrects the container size", () => {
    const stripped = stripMetadata(WEBP_WITH_EXIF, "image/webp");

    expect(stripped.byteLength).toBe(WEBP_WITH_EXIF.byteLength - 12);
    expect(String.fromCharCode(...stripped.subarray(12, 16))).toBe("VP8X");
    const declared = stripped[4] | (stripped[5] << 8) | (stripped[6] << 16) | (stripped[7] << 24);
    expect(declared).toBe(stripped.byteLength - 8);
  });

  it("is idempotent — a strip of a strip changes nothing, which is how the record path proves it worked", () => {
    for (const [bytes, mime] of [
      [PNG_WITH_TEXT, "image/png"],
      [JPEG_WITH_EXIF, "image/jpeg"],
      [WEBP_WITH_EXIF, "image/webp"],
    ] as const) {
      const once = stripMetadata(bytes, mime);
      expect(stripMetadata(once, mime).byteLength).toBe(once.byteLength);
    }
  });

  it("leaves GIF and video untouched, because the format has nothing to strip", () => {
    const gif = new TextEncoder().encode("GIF89a");
    expect(stripMetadata(gif, "image/gif").byteLength).toBe(gif.byteLength);
    expect(stripMetadata(JPEG_WITH_EXIF, "video/mp4").byteLength).toBe(JPEG_WITH_EXIF.byteLength);
  });
});

describe("dimensions come from the header", () => {
  it("reads PNG IHDR", () => {
    expect(dimensions(PNG, "image/png")).toEqual({ width: 1, height: 1 });
  });

  it("reads JPEG SOF0", () => {
    expect(dimensions(JPEG_WITH_EXIF, "image/jpeg")).toEqual({ width: 32, height: 16 });
  });

  it("reads a GIF's logical screen", () => {
    const gif = new Uint8Array([...asciiBytes("GIF89a"), 0x40, 0x01, 0xf0, 0x00]);
    expect(dimensions(gif, "image/gif")).toEqual({ width: 320, height: 240 });
  });

  it("says nothing rather than guessing for video and WebP", () => {
    const mp4 = new TextEncoder().encode("\0\0\0\x18ftypisom");
    expect(dimensions(mp4, "video/mp4")).toBeNull();
    expect(dimensions(WEBP_WITH_EXIF, "image/webp")).toBeNull();
  });

  it("returns null for a truncated header instead of throwing", () => {
    expect(dimensions(new Uint8Array([0xff, 0xd8]), "image/jpeg")).toBeNull();
  });
});

describe("keys and addresses are derived", () => {
  it("prefers r2_key, then a media/ key, and admits an import path has neither", () => {
    expect(objectKey({ key: "media/ws/a.jpg", r2Key: "media/ws/b.jpg" })).toBe("media/ws/b.jpg");
    expect(objectKey({ key: "media/ws/a.jpg", r2Key: null })).toBe("media/ws/a.jpg");
    expect(objectKey({ key: "brands/uwi/social/a.jpg", r2Key: null })).toBeNull();
    expect(objectKey({ key: "brands/uwi/social/a.jpg", r2Key: "media/ws/c.jpg" })).toBe("media/ws/c.jpg");
  });

  it("builds one URL from key and base, and refuses to build any without a base", () => {
    expect(publicMediaUrl("https://media.test/", "media/ws/a.jpg")).toBe("https://media.test/media/ws/a.jpg");
    expect(publicMediaUrl(" https://media.test ", "media/ws/a.jpg")).toBe("https://media.test/media/ws/a.jpg");
    expect(publicMediaUrl("", "media/ws/a.jpg")).toBeNull();
    expect(publicMediaUrl(undefined, "media/ws/a.jpg")).toBeNull();
    expect(publicMediaUrl("https://media.test", null)).toBeNull();
  });

  it("names extensions from the type, never from the filename", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("video/quicktime")).toBe("mov");
  });

  it("hashes exactly the bytes it is given", async () => {
    const hash = await sha256Hex(PNG);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(PNG)).toBe(hash);
    expect(await sha256Hex(Uint8Array.of(...PNG, 0x00))).not.toBe(hash);
  });

  it("states the ceiling once, in one place", () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("the signed upload URL", () => {
  const base = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "postvyn-bucket",
    key: "media/ws/upl_abc.png",
    contentType: "image/png",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    now: Date.UTC(2026, 10, 17, 10, 30, 0),
  };

  it("names one bucket and key, one content type, and an expiry", async () => {
    const url = new URL(await presignPut(base));

    expect(url.origin).toBe("https://account.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/postvyn-bucket/media/ws/upl_abc.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is reproducible for one key at one moment, and differs for another key or type", async () => {
    const first = await presignPut(base);
    expect(await presignPut(base)).toBe(first);

    const otherKey = await presignPut({ ...base, key: "media/ws/upl_xyz.png" });
    const otherType = await presignPut({ ...base, contentType: "image/jpeg" });
    const otherExpiry = await presignPut({ ...base, expiresSeconds: 60 });

    expect(new Set([first, otherKey, otherType, otherExpiry]).size).toBe(4);
  });

  it("encodes the key as path segments, so a slash cannot leave the bucket", async () => {
    const url = await presignPut({ ...base, key: "media/ws/a b.png" });
    expect(url).toContain("/postvyn-bucket/media/ws/a%20b.png");
  });
});
