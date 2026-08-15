import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/db";
import { checkServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = checkServerEnv();
  const databaseConnected = await checkDatabaseConnection().catch(() => false);

  return NextResponse.json({
    databaseConnected,
    twilioConfigured: env.ok || !env.missing.some((m) => m.startsWith("TWILIO_")),
    voiceServerConfigured: env.ok || !env.missing.includes("VOICE_SERVER_URL"),
    // Demo mode is optional, so its absence never appears in `missing` —
    // check directly. Never report the demo number itself here.
    demoCallConfigured: Boolean(process.env.DEMO_PHONE_NUMBER && process.env.DEMO_OPERATOR_SECRET),
    scamSinkNumber: process.env.TWILIO_PHONE_NUMBER ?? null,
    missingEnv: env.ok ? [] : env.missing,
  });
}
