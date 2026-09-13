export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}
export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const WEAK_JWT_DEFAULTS = new Set(["", "dev-secret-change-me-32chars-minimum!!", "change-me-to-64-hex-chars-min-32", "changeme", "secret"]);

export function isJwtSecretStrong(secret: string): boolean {
  return secret.length >= 32 && !WEAK_JWT_DEFAULTS.has(secret);
}
export const config = {
  databaseUrl: env("DATABASE_URL"),
  redisUrl: env("REDIS_URL", ""),
  /** Shared .env flag: web skips the queue consumer, the dedicated worker drains. */
  workerOnly: env("WORKER_ONLY", "") === "1",
  jwtSecret: env("JWT_SECRET", "dev-secret-change-me-32chars-minimum!!"),
  sessionCookie: env("SESSION_COOKIE_NAME", "ac_session"),
  sessionTtlHours: envInt("SESSION_TTL_HOURS", 168),
  appUrl: env("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  llm: {
    /** rulebased | openrouter | opencode | composite | openai(legacy). Default rulebased = offline-safe. */
    provider: env("LLM_PROVIDER", "rulebased"),
    /** Primary model. Free-model catalogs change often — see docs/MODELS.md. */
    model: env("LLM_MODEL", "z-ai/glm-5.2:free"),
    /** Second model tried on the primary gateway before switching provider. */
    fallbackModel: env("LLM_FALLBACK_MODEL", "google/gemma-4-31b-it:free"),
    apiKey: env("LLM_API_KEY", ""),
    baseUrl: env("LLM_BASE_URL", "https://api.openai.com/v1"),
    temperature: Number(env("LLM_TEMPERATURE", "0.2")) || 0.2,
    maxTokens: envInt("LLM_MAX_TOKENS", 1024),
    maxToolCalls: envInt("LLM_MAX_TOOL_CALLS", 8),
    timeoutMs: envInt("LLM_TIMEOUT_MS", 45000),
    /** Same-provider retries for retryable errors (total attempts = 1 + this, capped at 3). */
    maxRetries: Math.max(0, Math.min(2, envInt("LLM_MAX_RETRIES", 1))),
    /** Per-task model overrides; empty = use primary LLM_MODEL. */
    taskModels: {
      agent: env("LLM_MODEL_AGENT", ""),
      simple: env("LLM_MODEL_SIMPLE", ""),
      extract: env("LLM_MODEL_EXTRACT", ""),
      complex: env("LLM_MODEL_COMPLEX", ""),
      rag: env("LLM_MODEL_RAG", ""),
    },
    openrouter: {
      apiKey: env("OPENROUTER_API_KEY", ""),
      baseUrl: env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    },
    opencode: {
      apiKey: env("OPENCODE_API_KEY", ""),
      baseUrl: env("OPENCODE_BASE_URL", "https://opencode.ai/zen/v1"),
      model: env("OPENCODE_MODEL", "deepseek-v4-flash-free"),
    },
  },
  embedding: {
    provider: env("EMBEDDING_PROVIDER", "local"),
    model: env("EMBEDDING_MODEL", "local-hash-1536"),
    dim: envInt("EMBEDDING_DIM", 1536),
  },
  transcribe: {
    /** Empty key = voice notes get the instant text fallback (1A). No silent failure. */
    apiKey: env("TRANSCRIBE_API_KEY", ""),
    baseUrl: env("TRANSCRIBE_BASE_URL", "https://api.openai.com/v1"),
    model: env("TRANSCRIBE_MODEL", "whisper-1"),
    language: env("TRANSCRIBE_LANGUAGE", "ar"),
    timeoutMs: envInt("TRANSCRIBE_TIMEOUT_MS", 30000),
    maxBytes: envInt("TRANSCRIBE_MAX_BYTES", 25 * 1024 * 1024),
  },
  vision: {
    /** Empty key = photos get the instant text fallback. Output is a candidate only. */
    apiKey: env("VISION_API_KEY", ""),
    baseUrl: env("VISION_BASE_URL", "https://api.openai.com/v1"),
    model: env("VISION_MODEL", "gpt-4o-mini"),
    timeoutMs: envInt("VISION_TIMEOUT_MS", 30000),
    maxBytes: envInt("VISION_MAX_BYTES", 10 * 1024 * 1024),
    minConfidence: Number(env("VISION_MIN_CONFIDENCE", "0.7")) || 0.7,
    maxPerConversation: envInt("VISION_MAX_PER_CONVERSATION", 5),
  },
  whatsapp: {
    verifyToken: env("WHATSAPP_VERIFY_TOKEN", ""),
    appSecret: env("WHATSAPP_APP_SECRET", ""),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", ""),
    accessToken: env("WHATSAPP_ACCESS_TOKEN", ""),
    apiVersion: env("WHATSAPP_API_VERSION", "v21.0"),
  },
  instagram: {
    verifyToken: env("INSTAGRAM_VERIFY_TOKEN", ""),
    appSecret: env("INSTAGRAM_APP_SECRET", ""),
    userId: env("INSTAGRAM_USER_ID", ""),
    accessToken: env("INSTAGRAM_ACCESS_TOKEN", ""),
    apiVersion: env("INSTAGRAM_API_VERSION", "v21.0"),
  },
  messenger: {
    verifyToken: env("MESSENGER_VERIFY_TOKEN", ""),
    appSecret: env("MESSENGER_APP_SECRET", ""),
    pageId: env("MESSENGER_PAGE_ID", ""),
    accessToken: env("MESSENGER_ACCESS_TOKEN", ""),
    apiVersion: env("MESSENGER_API_VERSION", "v21.0"),
  },
  n8n: {
    orderWebhook: env("N8N_ORDER_WEBHOOK_URL", ""),
    genericWebhook: env("N8N_GENERIC_WEBHOOK_URL", ""),
  },
  sms: {
    /** Generic JSON SMS gateway ({to, text}). Empty = log driver. */
    webhookUrl: env("SMS_WEBHOOK_URL", ""),
    twilioAccountSid: env("TWILIO_ACCOUNT_SID", ""),
    twilioAuthToken: env("TWILIO_AUTH_TOKEN", ""),
    twilioFrom: env("TWILIO_FROM", ""),
  },
  email: {
    /** log (default, console only) | smtp | resend. Unconfigured providers fall back to log. */
    provider: env("EMAIL_PROVIDER", "log"),
    from: env("EMAIL_FROM", ""),
    smtp: {
      host: env("SMTP_HOST", ""),
      port: envInt("SMTP_PORT", 587),
      secure: env("SMTP_SECURE", "false") === "true",
      user: env("SMTP_USER", ""),
      pass: env("SMTP_PASS", ""),
    },
    resend: {
      apiKey: env("RESEND_API_KEY", ""),
    },
  },
  fawry: {
    merchantCode: env("FAWRY_MERCHANT_CODE", ""),
    secureKey: env("FAWRY_SECURE_KEY", ""),
    sandbox: env("FAWRY_SANDBOX", "true") !== "false",
  },
  sentry: {
    /** Empty = errors stay in structured logs only. Never exposed to the browser. */
    dsn: env("SENTRY_DSN", ""),
    environment: env("SENTRY_ENVIRONMENT", "") || env("NODE_ENV", "development"),
  },
  shipping: {
    /** Bosta API key (sandbox by default). Empty = no courier integration. */
    bostaApiKey: env("BOSTA_API_KEY", ""),
    /** Bosta webhook secret for HMAC verification. */
    bostaWebhookSecret: env("BOSTA_WEBHOOK_SECRET", ""),
    /** Use sandbox (true) or production (false). Default true for safety. */
    bostaSandbox: env("BOSTA_SANDBOX", "true") !== "false",
    /** Pickup address (merchant warehouse). */
    pickupFirstName: env("SHIPPING_PICKUP_FIRST_NAME", "Store"),
    pickupLastName: env("SHIPPING_PICKUP_LAST_NAME", "Pickup"),
    pickupPhone: env("SHIPPING_PICKUP_PHONE", "+201000000000"),
    pickupEmail: env("SHIPPING_PICKUP_EMAIL", ""),
    pickupAddressLine1: env("SHIPPING_PICKUP_ADDRESS_LINE1", "123 Warehouse St"),
    pickupCity: env("SHIPPING_PICKUP_CITY", "Cairo"),
    pickupState: env("SHIPPING_PICKUP_STATE", "Cairo"),
    pickupPostalCode: env("SHIPPING_PICKUP_POSTAL_CODE", ""),
  },
  rateLimit: {
    windowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000),
    maxAuth: envInt("RATE_LIMIT_MAX_AUTH", 20),
    maxWebhook: envInt("RATE_LIMIT_MAX_WEBHOOK", 300),
    maxApi: envInt("RATE_LIMIT_MAX_API", 300),
  },
  storage: {
    /** local (default, STORAGE_DIR volume) | s3 (S3-compatible, e.g. Cloudflare R2). Incomplete s3 falls back to local. */
    provider: env("STORAGE_PROVIDER", "local"),
    s3: {
      endpoint: env("S3_ENDPOINT", ""),
      region: env("S3_REGION", "auto"),
      bucket: env("S3_BUCKET", ""),
      accessKey: env("S3_ACCESS_KEY_ID", ""),
      secretKey: env("S3_SECRET_ACCESS_KEY", ""),
      publicBaseUrl: env("S3_PUBLIC_BASE_URL", ""),
    },
  },
};
