const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// Only used to expand a UK-style leading-0 local number (e.g. "07940...").
// Numbers already in +<countrycode> form are never touched.
const DEFAULT_COUNTRY_CODE = "44";

/**
 * Normalizes a user-entered phone number to E.164. Accepts numbers already
 * in "+..." form (formatting characters stripped) and UK-style local
 * numbers with a leading 0 (expanded via DEFAULT_COUNTRY_CODE). Anything
 * else is ambiguous without a declared country code, so this returns null
 * rather than guessing — callers must treat null as "reject".
 */
export function normalizePhoneNumberToE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const candidate = "+" + trimmed.slice(1).replace(/\D/g, "");
    return E164_PATTERN.test(candidate) ? candidate : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("0")) {
    const candidate = `+${DEFAULT_COUNTRY_CODE}${digits.slice(1)}`;
    return E164_PATTERN.test(candidate) ? candidate : null;
  }

  return null;
}

/** Parses a comma-separated allowlist env value into normalized E.164 numbers, dropping anything unparseable. */
export function parseAllowedPhoneNumbers(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => normalizePhoneNumberToE164(entry))
    .filter((entry): entry is string => entry !== null);
}

export function isAllowedDemoDestination(number: string, allowlist: string[]): boolean {
  return allowlist.includes(number);
}
