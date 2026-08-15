import { z } from "zod";

/**
 * Server-only environment schema for the voice-server process. Validated
 * once at process startup — the process refuses to start with a clear error
 * rather than limping along and faking AI responses later.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  VOICE_SERVER_SHARED_SECRET: z
    .string()
    .min(16, "VOICE_SERVER_SHARED_SECRET must be at least 16 characters"),
  PUBLIC_APP_URL: z.string().url("PUBLIC_APP_URL must be a valid URL"),
  AI_PROVIDER: z.enum(["anthropic"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  // Full dated snapshot id, as required by the Messages API today.
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-4-5-20251001"),
  PORT: z.coerce.number().int().positive().default(8080),
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
