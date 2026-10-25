/**
 * Date formatting (Section 4.4): the folder date is canonical; display
 * formatting is locale-aware and derived only from the ISO string.
 */

/** True when `iso` is a real YYYY-MM-DD calendar date. */
export function isIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(iso);
}

/** The YYYY segment of an ISO date, or "" when not a valid date. */
export function yearOf(iso: string): string {
  return isIsoDate(iso) ? iso.slice(0, 4) : "";
}

/** Format an ISO date for the given locale, e.g. "Dec 3, 2026". */
export function formatDate(iso: string, locale = "en-US"): string {
  if (!isIsoDate(iso)) {
    // Never show a wrong date; fall back to the canonical ISO string.
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}
