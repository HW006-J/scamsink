import Link from "next/link";
import { checkDatabaseConnection } from "@/lib/db";
import { checkServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-3 last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {detail && <span className="text-xs text-muted">{detail}</span>}
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-accent-green" : "bg-accent-red"}`}
          aria-hidden
        />
        <span className={`text-xs font-medium uppercase tracking-wide ${ok ? "text-accent-green" : "text-accent-red"}`}>
          {ok ? "Connected" : "Not ready"}
        </span>
      </div>
    </div>
  );
}

export default async function DemoPage() {
  const env = checkServerEnv();
  const databaseConnected = await checkDatabaseConnection().catch(() => false);
  const twilioConfigured = env.ok || !env.missing.some((m) => m.startsWith("TWILIO_"));
  const voiceServerConfigured = env.ok || !env.missing.includes("VOICE_SERVER_URL");
  const scamSinkNumber = process.env.TWILIO_PHONE_NUMBER;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-8 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Demo setup</h1>
        <p className="mt-2 text-sm text-muted">
          Everything you need to run the ScamSink demo end to end.
        </p>
      </div>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">ScamSink phone number</h2>
        <p className="mt-2 font-mono text-3xl">{scamSinkNumber || "Not configured"}</p>
        {!scamSinkNumber && (
          <p className="mt-1 text-sm text-accent-red">
            Set TWILIO_PHONE_NUMBER in your environment.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">System status</h2>
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface px-5">
          <StatusRow label="Dashboard" ok />
          <StatusRow label="Database (Neon Postgres)" ok={databaseConnected} />
          <StatusRow label="Twilio credentials" ok={twilioConfigured} />
          <StatusRow label="Voice backend configured" ok={voiceServerConfigured} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">Demo instructions</h2>
        <ol className="mt-3 space-y-2 text-sm text-foreground">
          <li>1. Call the ScamSink number above.</li>
          <li>2. Speak as a scam caller (e.g. &ldquo;we&rsquo;re calling about suspicious activity on your account&rdquo;).</li>
          <li>3. Watch ScamSink answer, confused and polite, on the dashboard.</li>
          <li>4. Watch the transcript update live as the call continues.</li>
          <li>5. Hang up.</li>
          <li>6. See total time wasted on the dashboard.</li>
        </ol>
      </section>

      <Link href="/" className="text-sm text-accent-green underline underline-offset-4">
        Back to dashboard
      </Link>
    </div>
  );
}
