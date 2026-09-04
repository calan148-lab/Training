import type { AppData, Supplement, SupplementDose } from './types';

/**
 * How long after starting creatine the scale stops telling the truth.
 *
 * Creatine draws water into muscle, so saturation shows up as bodyweight that
 * has nothing to do with fat. At a maintenance dose the rise lands over roughly
 * three to four weeks; a loading protocol front-loads the same water into one.
 * Either way the gain is real weight and fake progress, and the weight trend
 * cannot tell the two apart.
 */
export const CREATINE_WATER_DAYS = 28;

/**
 * Hour after which a stimulant dose is worth flagging against sleep.
 *
 * Caffeine's half-life is around five to six hours, so a late-afternoon dose
 * still has half its load on board at bedtime.
 */
export const LATE_STIMULANT_HOUR = 16;

export function byId(data: AppData): Map<string, Supplement> {
  return new Map(data.supplements.map((s) => [s.id, s]));
}

/** Doses falling within an inclusive ISO date range. */
export function dosesBetween(data: AppData, from: string, to: string): SupplementDose[] {
  return data.doses.filter((d) => d.date >= from && d.date <= to);
}

/** Doses of supplements of a given kind, within an inclusive date range. */
export function dosesOfKind(
  data: AppData,
  kind: Supplement['kind'],
  from: string,
  to: string,
): SupplementDose[] {
  const index = byId(data);
  return dosesBetween(data, from, to).filter((d) => index.get(d.supplementId)?.kind === kind);
}

/**
 * Calories and protein contributed by nutritive supplements, per day.
 *
 * A two-scoop day of whey is 40-50 g of protein — a third of a day's target at
 * a typical bodyweight. Left out of the totals it does not merely under-report
 * protein: measured maintenance is derived from logged intake, so every missing
 * shake also drags the maintenance estimate down and, with it, the calorie
 * target the whole plan steers by.
 */
export function nutritiveByDay(data: AppData): Map<string, { kcal: number; protein: number }> {
  const index = byId(data);
  const out = new Map<string, { kcal: number; protein: number }>();
  for (const dose of data.doses) {
    const s = index.get(dose.supplementId);
    if (!s || s.kind !== 'nutritive') continue;
    const cur = out.get(dose.date) ?? { kcal: 0, protein: 0 };
    cur.kcal += (s.kcal ?? 0) * dose.servings;
    cur.protein += (s.protein_g ?? 0) * dose.servings;
    out.set(dose.date, cur);
  }
  return out;
}

/** ISO date of the first creatine dose ever logged, or null. */
export function creatineStart(data: AppData): string | null {
  const index = byId(data);
  let first: string | null = null;
  for (const dose of data.doses) {
    if (index.get(dose.supplementId)?.kind !== 'creatine') continue;
    if (first === null || dose.date < first) first = dose.date;
  }
  return first;
}

/**
 * Whether a window overlaps the creatine saturation period, during which
 * bodyweight carries water that is not fat and must not be read as though it
 * were.
 */
export function creatineConfounds(data: AppData, from: string, to: string): boolean {
  const start = creatineStart(data);
  if (!start) return false;
  const end = new Date(new Date(start).getTime() + CREATINE_WATER_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  // Overlap if the window ends at or after the start and begins before saturation completes.
  return to >= start && from <= end;
}

/** Stimulant doses taken after LATE_STIMULANT_HOUR, local time. */
export function lateStimulantDoses(data: AppData, from: string, to: string): SupplementDose[] {
  return dosesOfKind(data, 'stimulant', from, to).filter((d) => {
    const at = new Date(d.at);
    return !Number.isNaN(at.getTime()) && at.getHours() >= LATE_STIMULANT_HOUR;
  });
}

/** Total caffeine, in mg, across a date range. */
export function caffeineBetween(data: AppData, from: string, to: string): number {
  const index = byId(data);
  return dosesBetween(data, from, to).reduce((sum, d) => {
    const s = index.get(d.supplementId);
    return sum + (s?.caffeine_mg ?? 0) * d.servings;
  }, 0);
}
