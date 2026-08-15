/**
 * Best-effort redaction of obvious sensitive numeric strings (card numbers,
 * account numbers, OTP-style codes) before transcript text is persisted.
 * This is a hackathon-grade safety net, NOT a production-grade sensitive-data
 * redaction system — see README "Security & Privacy".
 */
const DIGIT_RUN = /\d(?:[\s-]?\d){5,}/g;

export function redactSensitiveNumbers(text: string): string {
  return text.replace(DIGIT_RUN, "[REDACTED]");
}
