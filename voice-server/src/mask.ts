/**
 * Masks a phone number for storage/display, e.g. "+447911123456" -> "+44 **** **** 56".
 * Duplicated from the Next.js app's lib/mask.ts — the two services deploy
 * independently, so this stays a small standalone copy rather than a shared
 * package.
 */
export function maskPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return "UNKNOWN";

  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "****";

  const countryCode = digits.slice(0, 2);
  const last = digits.slice(-2);
  const middleLength = digits.length - 4;
  const groups = Math.max(1, Math.ceil(middleLength / 4));
  const stars = Array.from({ length: groups }, () => "****").join(" ");

  return `+${countryCode} ${stars} ${last}`;
}
