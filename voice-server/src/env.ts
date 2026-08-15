import { z } from "zod";

/**
 * Server-only environment schema for the voice-server process. Validated
 * once at process startup — the process refuses to start with a clear error
 * rather than limping along with missing config later.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  TWILIO_AUTH_TOKEN: z.string().trim().min(1, "TWILIO_AUTH_TOKEN is required"),
  VOICE_SERVER_SHARED_SECRET: z
    .string()
    .trim()
    .min(16, "VOICE_SERVER_SHARED_SECRET must be at least 16 characters"),
  PUBLIC_APP_URL: z.string().trim().url("PUBLIC_APP_URL must be a valid URL"),
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
