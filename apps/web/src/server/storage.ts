import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Product-image storage behind a driver interface (mirrors the email/SMS
 * driver pattern): local disk (dev + single-instance volumes) or any
 * S3-compatible object store (Cloudflare R2 in production).
 *
 * Selection is graceful: STORAGE_PROVIDER=s3 with incomplete credentials
 * falls back to local (and boot validation warns), so local dev works with
 * zero credentials. Public serving: local files via /api/files (unguessable
 * names); S3 objects via the bucket's public base URL.
 */

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
}

export interface StorageDriver {
  readonly name: string;
  save(tenantId: string, filename: string, bytes: Buffer, mime: string): Promise<{ url: string }>;
  delete(tenantId: string, filename: string): Promise<void>;
}

function storageRoot(): string {
  // apps/web/storage (gitignored). Override with STORAGE_DIR for prod volumes.
  return process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
}

export function validateImage(mime: string, bytes: number): string {
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new Error(`UNSUPPORTED_TYPE:${mime || "unknown"} (jpeg/png/webp only)`);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    throw new Error(`TOO_LARGE: max ${MAX_IMAGE_BYTES / 1024 / 1024}MB`);
  }
  return ext;
}

function assertSafeKey(tenantId: string, filename: string): void {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) throw new Error("INVALID_TENANT");
  if (!/^[A-Za-z0-9-]{1,80}\.(jpg|png|webp)$/.test(filename)) throw new Error("INVALID_FILENAME");
}

/* ─── SigV4 (S3-compatible PUT/DELETE over fetch, no new dependencies) ─────── */

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const p = (n: number) => String(n).padStart(2, "0");
  const dateStamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const amzDate = `${dateStamp}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

export function s3CanonicalRequest(method: string, pathname: string, host: string, amzDate: string, payloadHash: string): string {
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  return `${method}\n${pathname}\n\n${canonicalHeaders}\nhost;x-amz-content-sha256;x-amz-date\n${payloadHash}`;
}

export function s3Authorization(opts: {
  accessKey: string;
  secretKey: string;
  region: string;
  method: string;
  host: string;
  pathname: string;
  payloadHash: string;
  now?: Date;
}): { authorization: string; amzDate: string } {
  const { amzDate, dateStamp } = amzDates(opts.now);
  const canonical = s3CanonicalRequest(opts.method, opts.pathname, opts.host, amzDate, opts.payloadHash);
  const scope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${crypto.createHash("sha256").update(canonical).digest("hex")}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${opts.secretKey}`, dateStamp), opts.region), "s3"), "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    amzDate,
  };
}

/* ─── Drivers ──────────────────────────────────────────────────────────────── */

export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";
  constructor(private root?: string) {}

  private dir(tenantId: string): string {
    return path.join(this.root ?? storageRoot(), tenantId);
  }

  async save(tenantId: string, filename: string, bytes: Buffer): Promise<{ url: string }> {
    assertSafeKey(tenantId, filename);
    await fs.promises.mkdir(this.dir(tenantId), { recursive: true });
    await fs.promises.writeFile(path.join(this.dir(tenantId), filename), bytes);
    return { url: `/api/files/${tenantId}/${filename}` };
  }

  async delete(tenantId: string, filename: string): Promise<void> {
    const r = resolveStoredFile(tenantId, filename, this.root);
    if (!r) return;
    await fs.promises.unlink(r.abs).catch(() => {});
  }
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export class S3CompatibleStorageDriver implements StorageDriver {
  readonly name = "s3";
  constructor(private s3: S3Config) {}

  private host(): string {
    return new URL(this.s3.endpoint).host;
  }

  private objectPath(tenantId: string, filename: string): string {
    return `/${this.s3.bucket}/${tenantId}/${encodeKey(filename)}`;
  }

  objectUrl(tenantId: string, filename: string): string {
    const base = this.s3.publicBaseUrl ? this.s3.publicBaseUrl.replace(/\/$/, "") : `${this.s3.endpoint.replace(/\/$/, "")}/${this.s3.bucket}`;
    return `${base}/${tenantId}/${encodeKey(filename)}`;
  }

  /** Extract a (tenantId, filename) pair from one of our own object URLs. */
  keyFromUrl(url: string): { tenantId: string; filename: string } | null {
    const bases = [this.s3.publicBaseUrl.replace(/\/$/, ""), `${this.s3.endpoint.replace(/\/$/, "")}/${this.s3.bucket}`].filter(Boolean);
    for (const base of bases) {
      if (!url.startsWith(`${base}/`)) continue;
      const rest = url.slice(base.length + 1);
      const slash = rest.indexOf("/");
      if (slash <= 0) continue;
      const tenantId = rest.slice(0, slash);
      const filename = decodeURIComponent(rest.slice(slash + 1));
      try {
        assertSafeKey(tenantId, filename);
        return { tenantId, filename };
      } catch {
        return null;
      }
    }
    return null;
  }

  private async signedRequest(method: "PUT" | "DELETE", tenantId: string, filename: string, bytes?: Buffer, mime?: string): Promise<void> {
    assertSafeKey(tenantId, filename);
    const payloadHash = bytes ? crypto.createHash("sha256").update(bytes).digest("hex") : EMPTY_SHA256;
    const host = this.host();
    const pathname = this.objectPath(tenantId, filename);
    const { authorization, amzDate } = s3Authorization({
      accessKey: this.s3.accessKey,
      secretKey: this.s3.secretKey,
      region: this.s3.region || "auto",
      method,
      host,
      pathname,
      payloadHash,
    });
    const url = `${this.s3.endpoint.replace(/\/$/, "")}${pathname}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
        ...(mime ? { "Content-Type": mime } : {}),
      },
      body: bytes ? new Uint8Array(bytes) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("S3 storage request failed", { method, status: res.status, body: text.slice(0, 400) });
      throw new Error(`S3 ${method} ${res.status}`);
    }
  }

  async save(tenantId: string, filename: string, bytes: Buffer, mime: string): Promise<{ url: string }> {
    await this.signedRequest("PUT", tenantId, filename, bytes, mime);
    return { url: this.objectUrl(tenantId, filename) };
  }

  async delete(tenantId: string, filename: string): Promise<void> {
    await this.signedRequest("DELETE", tenantId, filename).catch((err) => {
      logger.warn("S3 delete failed (object may already be gone)", { error: String(err).slice(0, 200) });
    });
  }
}

/* ─── Selection (cached, graceful fallback like the email driver) ──────────── */

export function resolveStorageDriver(cfg: { provider: string; s3: S3Config }): StorageDriver {
  if (cfg.provider === "s3") {
    if (cfg.s3.endpoint && cfg.s3.bucket && cfg.s3.accessKey && cfg.s3.secretKey) {
      return new S3CompatibleStorageDriver(cfg.s3);
    }
    logger.warn("S3 storage selected but incomplete — falling back to local driver");
  } else if (cfg.provider !== "local") {
    logger.warn("unknown STORAGE_PROVIDER — falling back to local driver", { provider: cfg.provider });
  }
  return new LocalStorageDriver();
}

let cachedDriver: StorageDriver | null = null;

export function storageDriver(): StorageDriver {
  if (!cachedDriver) {
    cachedDriver = resolveStorageDriver({ provider: config.storage.provider, s3: config.storage.s3 });
    logger.info("storage driver enabled", { driver: cachedDriver.name });
  }
  return cachedDriver;
}

/** Test hook: drop the cached driver so env/config changes take effect. */
export function resetStorageDriverForTest(): void {
  cachedDriver = null;
}

/* ─── Module functions (same signatures as before) ─────────────────────────── */

export async function saveProductImage(tenantId: string, bytes: Buffer, mime: string): Promise<{ url: string; filename: string }> {
  const ext = validateImage(mime, bytes.length);
  const filename = `${crypto.randomUUID()}.${ext}`;
  const { url } = await storageDriver().save(tenantId, filename, bytes, mime);
  return { url, filename };
}

export function resolveStoredFile(tenantId: string, filename: string, root?: string): { abs: string; mime: string } | null {
  // Strict shape guard: no directories, no traversal, known extensions.
  if (!/^[A-Za-z0-9-]{1,80}\.(jpg|png|webp)$/.test(filename)) return null;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return null;
  const base = path.join(root ?? storageRoot(), tenantId);
  const abs = path.join(base, filename);
  if (!abs.startsWith(base)) return null;
  const mime = filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { abs, mime };
}

export async function deleteStoredFile(tenantId: string, filename: string): Promise<void> {
  const r = resolveStoredFile(tenantId, filename);
  if (!r) return;
  await fs.promises.unlink(r.abs).catch(() => {});
}

/** Delete by stored URL: local /api/files URLs or our own S3 object URLs. */
export async function deleteProductImage(tenantId: string, url: string): Promise<void> {
  const local = filenameFromUrl(url);
  if (local) {
    await deleteStoredFile(tenantId, local);
    return;
  }
  const driver = storageDriver();
  if (driver instanceof S3CompatibleStorageDriver) {
    const key = driver.keyFromUrl(url);
    if (key && key.tenantId === tenantId) await driver.delete(tenantId, key.filename);
  }
}

export function filenameFromUrl(url: string): string | null {
  const m = /^\/api\/files\/[^/]+\/([A-Za-z0-9-]{1,80}\.(jpg|png|webp))$/.exec(url);
  return m ? m[1] : null;
}
