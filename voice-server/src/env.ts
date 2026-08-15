import { z } from "zod";

/**
 * Server-only environment schema for the voice-server process. Validated
 * once at process startup — the process refuses to start with a clear error
 * rather than limping along and faking AI responses later.
 *
 * AI_PROVIDER selects which provider's credentials are actually required:
 * only the selected provider's API key is mandatory, so switching providers
 * never requires configuring the other one too.
 */
const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
    VOICE_SERVER_SHARED_SECRET: z
      .string()
      .min(16, "VOICE_SERVER_SHARED_SECRET must be at least 16 characters"),
    PUBLIC_APP_URL: z.string().url("PUBLIC_APP_URL must be a valid URL"),
    AI_PROVIDER: z.enum(["groq", "anthropic"]).default("groq"),
    // Fast, low-latency, generous free tier — the production default for the
    // live voice loop. Optional at the schema level; required in practice
    // when AI_PROVIDER=groq (enforced below).
    GROQ_API_KEY: z.string().min(1).optional(),
    GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
    // Optional legacy/fallback provider — no longer required for production.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5"),
    PORT: z.coerce.number().int().positive().default(8080),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "groq" && !env.GROQ_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GROQ_API_KEY"],
        message: "GROQ_API_KEY is required when AI_PROVIDER=groq",
      });
    }
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Missing or invalid environment configuration: ${issues}`);
  }
  return result.data;
}
