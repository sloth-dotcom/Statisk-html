export const APP_TIME_ZONE = "Europe/Copenhagen";

/**
 * Everything is stored in UTC and rendered in Europe/Copenhagen (SPEC §8).
 * Offsets are derived from the IANA database via Intl rather than hardcoded,
 * so the DST switch is not a yearly bug.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * Turn a wall-clock time in Copenhagen into the UTC instant it refers to.
 * Two passes: the first offset guess can be wrong within an hour of a DST jump.
 */
export function copenhagenWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(naive - offsetMinutes(new Date(naive), APP_TIME_ZONE) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, APP_TIME_ZONE) * 60_000);
  return guess;
}

export function formatCopenhagen(
  value: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("da-DK", { timeZone: APP_TIME_ZONE, ...options }).format(date);
}

export function formatDateCopenhagen(value: Date | string | null | undefined): string {
  return formatCopenhagen(value, { dateStyle: "medium" });
}

/**
 * Whole days from `now` until `deadline`, counted on Copenhagen calendar days.
 * A deadline later today is 0 days left, not "less than one".
 */
export function daysUntil(deadline: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!deadline) return null;
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(target.getTime())) return null;
  const dayKey = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return Date.parse(`${parts}T00:00:00Z`);
  };
  return Math.round((dayKey(target) - dayKey(now)) / 86_400_000);
}

export function isPast(value: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}
