import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MAX_IMAGE_BYTES,
  filenameFromUrl,
  resolveStoredFile,
  resolveStorageDriver,
  validateImage,
  LocalStorageDriver,
  S3CompatibleStorageDriver,
  deleteProductImage,
  s3Authorization,
  s3CanonicalRequest,
  saveProductImage,
} from "./storage";

describe("product image storage guards", () => {
  it("accepts jpeg/png/webp within size", () => {
    expect(validateImage("image/jpeg", 100)).toBe("jpg");
    expect(validateImage("image/png", MAX_IMAGE_BYTES)).toBe("png");
    expect(validateImage("image/webp", 10)).toBe("webp");
  });

  it("rejects executables, svg, oversized and empty files", () => {
    expect(() => validateImage("application/x-sh", 100)).toThrow("UNSUPPORTED_TYPE");
    expect(() => validateImage("image/svg+xml", 100)).toThrow("UNSUPPORTED_TYPE");
    expect(() => validateImage("", 100)).toThrow("UNSUPPORTED_TYPE");
    expect(() => validateImage("image/jpeg", 0)).toThrow("TOO_LARGE");
    expect(() => validateImage("image/jpeg", MAX_IMAGE_BYTES + 1)).toThrow("TOO_LARGE");
  });

  it("resolves only safe tenant/file shapes (no traversal)", () => {
    const good = resolveStoredFile("cmto123abc", "550e8400-e29b-41d4-a716-446655440000.png");
    expect(good?.mime).toBe("image/png");
    expect(resolveStoredFile("cmto123abc", "../../etc/passwd")).toBeNull();
    expect(resolveStoredFile("cmto123abc", "x.exe")).toBeNull();
    expect(resolveStoredFile("../evil", "550e8400-e29b-41d4-a716-446655440000.png")).toBeNull();
    expect(filenameFromUrl("/api/files/cmto123/550e8400-e29b-41d4-a716-446655440000.webp")).toBe(
      "550e8400-e29b-41d4-a716-446655440000.webp"
    );
    expect(filenameFromUrl("/api/files/cmto123/%2e%2e%2fetc")).toBeNull();
  });
});

const S3 = {
  endpoint: "https://abc.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "imgs",
  accessKey: "AKID",
  secretKey: "sekret",
  publicBaseUrl: "https://pub-xxx.r2.dev",
};

describe("storage driver selection", () => {
  it("uses s3 only when fully configured, else falls back to local", () => {
    expect(resolveStorageDriver({ provider: "s3", s3: S3 }).name).toBe("s3");
    expect(resolveStorageDriver({ provider: "s3", s3: { ...S3, secretKey: "" } }).name).toBe("local");
    expect(resolveStorageDriver({ provider: "local", s3: S3 }).name).toBe("local");
    expect(resolveStorageDriver({ provider: "ftp", s3: S3 }).name).toBe("local");
  });
});

describe("local driver roundtrip", () => {
  it("saves and deletes inside an isolated root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
    try {
      const driver = new LocalStorageDriver(root);
      const bytes = Buffer.from("fake-image-bytes");
      const { url } = await driver.save("tenant1", "550e8400-e29b-41d4-a716-446655440000.png", bytes);
      expect(url).toBe("/api/files/tenant1/550e8400-e29b-41d4-a716-446655440000.png");
      expect(fs.readFileSync(path.join(root, "tenant1", "550e8400-e29b-41d4-a716-446655440000.png")).toString()).toBe("fake-image-bytes");
      await driver.delete("tenant1", "550e8400-e29b-41d4-a716-446655440000.png");
      expect(fs.existsSync(path.join(root, "tenant1", "550e8400-e29b-41d4-a716-446655440000.png"))).toBe(false);
      await expect(driver.save("../../evil", "550e8400-e29b-41d4-a716-446655440000.png", bytes)).rejects.toThrow("INVALID_TENANT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("deleteProductImage removes local files by URL and ignores foreign URLs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
    const prev = process.env.STORAGE_DIR;
    process.env.STORAGE_DIR = root;
    try {
      const bytes = Buffer.from("img");
      const { url, filename } = await saveProductImage("tenant9", bytes, "image/png");
      expect(fs.existsSync(path.join(root, "tenant9", filename))).toBe(true);
      await deleteProductImage("tenant9", url);
      expect(fs.existsSync(path.join(root, "tenant9", filename))).toBe(false);
      await deleteProductImage("tenant9", "https://evil.example/x.png");
    } finally {
      if (prev === undefined) delete process.env.STORAGE_DIR;
      else process.env.STORAGE_DIR = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("SigV4 signing", () => {
  it("builds the exact canonical request", () => {
    expect(s3CanonicalRequest("PUT", "/imgs/t1/abc.jpg", "abc.r2.cloudflarestorage.com", "20260101T000000Z", "abc123")).toBe(
      "PUT\n/imgs/t1/abc.jpg\n\nhost:abc.r2.cloudflarestorage.com\nx-amz-content-sha256:abc123\nx-amz-date:20260101T000000Z\n\nhost;x-amz-content-sha256;x-amz-date\nabc123"
    );
  });

  it("emits a well-formed authorization header (deterministic for a fixed date)", () => {
    const a = s3Authorization({
      accessKey: "AKID",
      secretKey: "sekret",
      region: "auto",
      method: "PUT",
      host: "abc.r2.cloudflarestorage.com",
      pathname: "/imgs/t1/abc.jpg",
      payloadHash: "abc123",
      now: new Date(Date.UTC(2026, 0, 1)),
    });
    expect(a.amzDate).toBe("20260101T000000Z");
    expect(a.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20260101\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    const b = s3Authorization({
      accessKey: "AKID",
      secretKey: "other",
      region: "auto",
      method: "PUT",
      host: "abc.r2.cloudflarestorage.com",
      pathname: "/imgs/t1/abc.jpg",
      payloadHash: "abc123",
      now: new Date(Date.UTC(2026, 0, 1)),
    });
    expect(b.authorization).not.toBe(a.authorization);
  });
});

describe("S3 driver (mocked fetch, no network)", () => {
  it("PUTs the object and returns the public URL; keyFromUrl round-trips", async () => {
    const seen: Array<{ url: string; method: string; auth: string; sha: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
      seen.push({ url: String(url), method: init?.method ?? "", auth: init?.headers?.Authorization ?? "", sha: init?.headers?.["x-amz-content-sha256"] ?? "" });
      return { ok: true } as Response;
    }) as typeof fetch;
    try {
      const driver = new S3CompatibleStorageDriver(S3);
      const bytes = Buffer.from("img-bytes");
      const { url } = await driver.save("t1", "550e8400-e29b-41d4-a716-446655440000.jpg", bytes, "image/jpeg");
      expect(url).toBe("https://pub-xxx.r2.dev/t1/550e8400-e29b-41d4-a716-446655440000.jpg");
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe("https://abc.r2.cloudflarestorage.com/imgs/t1/550e8400-e29b-41d4-a716-446655440000.jpg");
      expect(seen[0].method).toBe("PUT");
      expect(seen[0].auth).toMatch(/^AWS4-HMAC-SHA256 /);
      expect(seen[0].sha).toMatch(/^[0-9a-f]{64}$/);
      expect(driver.keyFromUrl(url)).toEqual({ tenantId: "t1", filename: "550e8400-e29b-41d4-a716-446655440000.jpg" });
      expect(driver.keyFromUrl("https://evil.example/t1/550e8400-e29b-41d4-a716-446655440000.jpg")).toBeNull();
      expect(driver.keyFromUrl("https://pub-xxx.r2.dev/other/../../../../etc")).toBeNull();
      await driver.delete("t1", "550e8400-e29b-41d4-a716-446655440000.jpg");
      expect(seen).toHaveLength(2);
      expect(seen[1].method).toBe("DELETE");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("throws on non-2xx without leaking bytes", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, status: 403, text: async () => "denied" }) as Response) as typeof fetch;
    try {
      const driver = new S3CompatibleStorageDriver(S3);
      await expect(driver.save("t1", "550e8400-e29b-41d4-a716-446655440000.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow("S3 PUT 403");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
