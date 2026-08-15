/**
 * Pure duration calculation shared by the dashboard API and the voice server.
 * For an in-progress call, duration is measured against `now`. For a
 * completed call, `endedAt` (or a stored duration) should be used instead.
 */
export function calculateDurationSeconds(
  startedAt: Date | string | null,
  endedAt: Date | string | null,
  now: Date = new Date()
): number {
  if (!startedAt) return 0;

  const start = typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const end = endedAt ? (typeof endedAt === "string" ? new Date(endedAt) : endedAt) : now;

  const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
  return Math.max(0, seconds);
}

/** "2:14" — natural (unpadded) minutes, general-purpose m:ss form. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** "02:14" — zero-padded minutes, used for the live ticking call timer. */
export function formatTimerClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** "2m 14s" / "45s" — short form for the completed-call headline duration. */
export function formatDurationShort(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** "4 minutes 37 seconds" — full words, used for the descriptive summary line. */
export function formatDurationLong(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
}
