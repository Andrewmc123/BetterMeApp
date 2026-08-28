/**
 * All week boundaries in the app are Monday 00:00 -> Sunday 23:59:59 UTC.
 * Storing them normalised keeps the Monday-plan / Friday-review pairing simple.
 */
export function startOfDay(d: Date | string): Date {
  const date = new Date(d);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(d: Date | string): Date {
  const date = new Date(d);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

/** Monday of the week containing `d`. */
export function weekStart(d: Date | string = new Date()): Date {
  const date = startOfDay(d);
  const dow = date.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + diff);
  return date;
}

/** Sunday end-of-day for the week containing `d`. */
export function weekEnd(d: Date | string = new Date()): Date {
  const start = weekStart(d);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return endOfDay(end);
}

export function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setUTCDate(date.getUTCDate() + n);
  return date;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
