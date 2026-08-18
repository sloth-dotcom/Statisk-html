import { z } from "zod";

/**
 * Env is validated lazily on first use, not at import time: `next build`
 * imports every route module, and a missing SLACK_WEBHOOK_URL should not fail
 * a build. Anything genuinely required is asserted by the code path that needs it.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  UDBUD_API_BASE_URL: z.string().url().optional(),
  UDBUD_API_KEY: z.string().optional(),
  UDBUD_API_KEY_HEADER: z.string().default("X-API-Key"),
  UDBUD_MAX_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  UDBUD_PAGE_SIZE: z.coerce.number().int().positive().max(200).default(50),
  UDBUD_MAX_PAGES: z.coerce.number().int().positive().max(1000).default(200),
  INGEST_OVERLAP_HOURS: z.coerce.number().int().nonnegative().default(24),
  INGEST_INITIAL_LOOKBACK_DAYS: z.coerce.number().int().positive().default(30),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  SCORING_MAX_NOTICES_PER_RUN: z.coerce.number().int().positive().default(50),
  SCORING_BATCH_SIZE: z.coerce.number().int().positive().max(20).default(5),
  CRON_SECRET: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  DIGEST_FROM: z.string().default("Udbudsradar <udbudsradar@example.dk>"),
  DIGEST_RECIPIENTS: z.string().default(""),
  DIGEST_MAX_ITEMS: z.coerce.number().int().positive().default(15),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Ugyldig miljøkonfiguration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache(): void {
  cached = null;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === "") {
    throw new Error(`Miljøvariablen ${String(key)} mangler. Se .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}

export function digestRecipients(): string[] {
  return env()
    .DIGEST_RECIPIENTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
