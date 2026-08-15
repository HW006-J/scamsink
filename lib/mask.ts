/**
 * Masks a phone number for display, e.g. "+447911123456" -> "+44 **** **** 56".
 * Keeps a country-code-ish prefix and the last two digits; everything else is
 * replaced with asterisk groups. Never persist or log the unmasked number
 * unless strictly required for Twilio call control.
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
