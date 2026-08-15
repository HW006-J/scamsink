/** Minimal structured logger. Never pass raw transcript content — callers should redact first. */
export function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

export function logError(event: string, error: unknown, data: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ts: new Date().toISOString(), event, error: message, ...data }));
}
