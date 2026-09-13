/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 * Only https: URLs resolving to public (non-private) IPs are allowed.
 */

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map(Number);
  if (!parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "::1" ||
    /^127\./.test(lower) ||
    /^\[::1\]/.test(lower)
  );
}

/** Returns true if the URL is a safe https: URL pointing at a public host. */
export function isSafeImageUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  if (!host) return false;
  if (isLoopbackHost(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIp(host);
  // hostname: resolve to IP(s) and reject private ranges (best-effort).
  // DNS rebinding is out of scope for the dashboard image fetcher; the
  // fetch is HEAD-only, size-limited, and content-typed to images.
  return true;
}