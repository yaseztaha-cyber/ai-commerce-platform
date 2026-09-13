/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework via X-Powered-By.
  poweredByHeader: false,
  transpilePackages: ["@ai-commerce/shared", "@ai-commerce/database"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
  // Baseline security headers. CSP is enforced per-request in middleware.ts
  // (nonce-based; the framework picks the nonce up via the x-nonce header).
  // No HSTS: only valid behind TLS, which is the proxy's job (see DEPLOYMENT).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // Public unguessable media must stay embeddable cross-site (merchants
      // show product photos in their own stores / WhatsApp catalogs).
      {
        source: "/api/files/:path*",
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
      },
    ];
  },
};

export default nextConfig;
