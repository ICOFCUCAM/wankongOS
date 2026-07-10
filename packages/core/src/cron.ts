/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports `*`, numbers, lists (`1,15`), ranges (`1-5`), and steps (star/5,
 * `10-30/5`). Pure and deterministic — the scheduler's only time authority.
 *
 * Standard cron semantics: when BOTH day-of-month and day-of-week are
 * restricted, the entry matches if EITHER matches.
 */

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

export class CronParseError extends Error {}

/** Parse one cron field into the set of matching values. */
function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(`Bad step in "${part}"`);

    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "") {
      lo = min;
      hi = max;
    } else if (rangePart!.includes("-")) {
      const [a, b] = rangePart!.split("-").map(Number);
      lo = a!;
      hi = b!;
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new CronParseError(`Bad range in "${part}" (${min}-${max})`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(`Expected 5 fields, got ${fields.length}: "${expression}"`);
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minute: parseField(minute, ...FIELD_RANGES[0]!),
    hour: parseField(hour, ...FIELD_RANGES[1]!),
    dayOfMonth: parseField(dom, ...FIELD_RANGES[2]!),
    month: parseField(month, ...FIELD_RANGES[3]!),
    dayOfWeek: parseField(dow.replace(/7/g, "0"), ...FIELD_RANGES[4]!),
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

/** Does the expression match this instant (minute resolution, UTC)? */
export function cronMatches(expression: string, date: Date): boolean {
  const cron = parseCron(expression);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();

  if (!cron.minute.has(minute) || !cron.hour.has(hour) || !cron.month.has(month)) return false;

  if (cron.domRestricted && cron.dowRestricted) {
    return cron.dayOfMonth.has(dom) || cron.dayOfWeek.has(dow);
  }
  return cron.dayOfMonth.has(dom) && cron.dayOfWeek.has(dow);
}

/** Is the expression syntactically valid? */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}
