import { z } from "zod";

/**
 * Server-only environment schema. Validated lazily (not at module load) so
 * `next build` never requires real secrets to be present. Routes that need
 * these values call getServerEnv() and must surface a clear failure state
 * if validation fails — never fall back to fake data.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TWILIO_ACCOUNT_SID: z.string().min(1, "TWILIO_ACCOUNT_SID is required"),
  TWILIO_AUTH_TOKEN: z.string().min(1, "TWILIO_AUTH_TOKEN is required"),
  TWILIO_PHONE_NUMBER: z.string().min(1, "TWILIO_PHONE_NUMBER is required"),
  PUBLIC_APP_URL: z.string().url("PUBLIC_APP_URL must be a valid URL"),
  VOICE_SERVER_URL: z.string().min(1, "VOICE_SERVER_URL is required"),
  VOICE_SERVER_SHARED_SECRET: z.string().min(16, "VOICE_SERVER_SHARED_SECRET must be at least 16 characters"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvValidationError";
  }
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvValidationError(`Missing or invalid environment configuration: ${issues}`);
  }

  cached = result.data;
  return cached;
}

/** Non-throwing variant for status/health surfaces that need to report what's missing. */
export function checkServerEnv(): { ok: true } | { ok: false; missing: string[] } {
  const result = serverEnvSchema.safeParse(process.env);
  if (result.success) return { ok: true };
  return { ok: false, missing: result.error.issues.map((i) => i.path.join(".")) };
}
