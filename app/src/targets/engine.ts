import { allWeights, isFullSession } from '../domain/progress';
import {
  creatineConfounds,
  dosesOfKind,
  lateStimulantDoses,
  nutritiveByDay,
} from '../domain/supplements';
import type { AppData, HealthDay, Meal } from '../domain/types';
import { todayISO } from '../domain/types';

export type TargetStatus =
  /** Inside the band. */
  | 'in'
  /** Below the band. */
  | 'low'
  /** Above the band. */
  | 'high'
  /** Context, not pass/fail — reported but never counted as failing. */
  | 'info'
  /** Not enough data to judge. Never counted either way. */
  | 'nodata';

export interface TargetResult {
  id: string;
  name: string;
  status: TargetStatus;
  /** Formatted current value for display, or null when nodata. */
  display: string | null;
  value: number | null;
  /** Human-readable target band. */
  band: string;
  /** One line of plain English: what this means and what to do. */
  note: string;
  /** Recent values for a sparkline, oldest first. */
  series: number[];
  /** How loudly this should shout when out of range. Higher wins. */
  priority: number;
}

export interface Verdict {
  results: TargetResult[];
  /** Targets inside their band, out of those actually judgeable. */
  inCount: number;
  judgeable: number;
  /** The single most important thing to do, or null when all is well. */
  headline: string | null;
}

/**
 * Energy density used to turn a weight trend into a calorie delta. 7,700 kcal/kg
 * is the conventional figure for adipose tissue; gained tissue in a lean bulk is
 * a mix of muscle and fat and so runs somewhat cheaper, which makes derived
 * maintenance a slightly conservative estimate. That is the safer direction to
 * err in: it never tells you to eat less than you should.
 */
export const KCAL_PER_KG = 7700;

const DAY_MS = 864e5;
const DAYS_PER_MONTH = 30.44;

export interface DatedValue {
  date: string;
  v: number;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

function shiftDate(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Values from a Health field, oldest first. */
export function healthSeries(data: AppData, field: keyof HealthDay): DatedValue[] {
  return Object.entries(data.health.days)
    .flatMap(([date, day]) => {
      const v = day[field];
      return v == null ? [] : [{ date, v }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Entries within the trailing `days` window ending at `end` (inclusive). */
export function windowOf(series: DatedValue[], days: number, end: string): DatedValue[] {
  const from = shiftDate(end, -(days - 1));
  return series.filter((p) => p.date >= from && p.date <= end);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Least-squares slope in units per day.
 *
 * This is what replaces comparing the first weigh-in to the last: two readings a
 * month apart can show a gain that the fortnight in between flatly contradicts,
 * and day-to-day bodyweight noise is larger than the signal we're looking for.
 */
export function slopePerDay(points: DatedValue[]): number | null {
  if (points.length < 2) return null;
  const t0 = new Date(points[0]!.date).getTime();
  const xs = points.map((p) => (new Date(p.date).getTime() - t0) / DAY_MS);
  const ys = points.map((p) => p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    num += dx * (ys[i]! - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

/** Confirmed meals only — an unconfirmed estimate is a guess we haven't agreed to. */
export function confirmedMeals(data: AppData): Meal[] {
  return data.meals.filter((m) => m.status === 'confirmed');
}

export interface DayIntake {
  kcal: number;
  protein: number;
  /**
   * Whether the day has at least one confirmed meal behind it.
   *
   * A day whose only entry is a protein shake is not a record of what you ate.
   * Counting it as a logged day would drag the 14-day mean down and, because
   * maintenance is derived from that mean, mis-state the calorie target the
   * whole plan steers by. Supplements add to a day's totals; they cannot on
   * their own make a day countable.
   */
  hasMeal: boolean;
}

/** Per-day intake from confirmed meals plus nutritive supplement doses. */
export function intakeByDay(data: AppData): Map<string, DayIntake> {
  const out = new Map<string, DayIntake>();
  const at = (date: string): DayIntake => {
    let cur = out.get(date);
    if (!cur) {
      cur = { kcal: 0, protein: 0, hasMeal: false };
      out.set(date, cur);
    }
    return cur;
  };
  for (const m of confirmedMeals(data)) {
    const cur = at(m.date);
    cur.kcal += m.totals.kcal;
    cur.protein += m.totals.protein_g;
    cur.hasMeal = true;
  }
  for (const [date, v] of nutritiveByDay(data)) {
    const cur = at(date);
    cur.kcal += v.kcal;
    cur.protein += v.protein;
  }
  return out;
}

/** Days in the window that actually have logged intake. */
function intakeWindow(data: AppData, days: number, end: string): DatedValue[] {
  const from = shiftDate(end, -(days - 1));
  return [...intakeByDay(data).entries()]
    .filter(([d, v]) => v.hasMeal && d >= from && d <= end)
    .map(([date, v]) => ({ date, v: v.kcal }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function proteinWindow(data: AppData, days: number, end: string): DatedValue[] {
  const from = shiftDate(end, -(days - 1));
  return [...intakeByDay(data).entries()]
    .filter(([d, v]) => v.hasMeal && d >= from && d <= end)
    .map(([date, v]) => ({ date, v: v.protein }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Most recent bodyweight from any source. */
export function currentWeight(data: AppData): number | null {
  const w = allWeights(data);
  return w.length ? w[w.length - 1]!.kg : null;
}

const nodata = (
  id: string,
  name: string,
  band: string,
  note: string,
  priority: number,
): TargetResult => ({ id, name, status: 'nodata', display: null, value: null, band, note, series: [], priority });

/* ------------------------------------------------------------------ */
/* Individual targets                                                  */
/* ------------------------------------------------------------------ */

/** Band edges by goal, in kg per month. */
function weightBand(data: AppData): { lo: number; hi: number; label: string } {
  switch (data.profile.goal) {
    case 'cut':
      return { lo: -2.2, hi: -1.1, label: '−1.1 to −2.2 kg/mo' };
    case 'recomp':
      return { lo: -0.3, hi: 0.3, label: 'hold, ±0.3 kg/mo' };
    default:
      return { lo: 0.25, hi: 0.5, label: '+0.25 to +0.5 kg/mo' };
  }
}

export function weightTrendTarget(data: AppData, end: string): TargetResult {
  const band = weightBand(data);
  const id = 'weight';
  const name = 'Weight trend';
  const series = allWeights(data).map((w) => ({ date: w.date, v: w.kg }));
  const win = windowOf(series, 28, end);

  if (win.length < 3 || daysBetween(win[0]!.date, win[win.length - 1]!.date) < 10) {
    return nodata(
      id,
      name,
      band.label,
      'Needs at least 3 weigh-ins spanning 10+ days before a trend means anything.',
      100,
    );
  }
  const perDay = slopePerDay(win);
  if (perDay == null) return nodata(id, name, band.label, 'Weigh-ins are all on one day.', 100);

  const perMonth = perDay * DAYS_PER_MONTH;
  const value = Math.round(perMonth * 100) / 100;
  const display = `${value >= 0 ? '+' : ''}${value.toFixed(2)} kg/mo`;
  const spanDays = daysBetween(win[0]!.date, win[win.length - 1]!.date);

  let status: TargetStatus = 'in';
  let note = `Gaining steadily over the last ${spanDays} days. Keep doing what you're doing.`;
  if (perMonth < band.lo) {
    status = 'low';
    note =
      data.profile.goal === 'gain'
        ? `Only ${display} over ${spanDays} days — under the band. Eat more; about +${surplusFor(data)} kcal/day above maintenance is the band's midpoint.`
        : `${display} over ${spanDays} days is below the band.`;
  } else if (perMonth > band.hi) {
    status = 'high';
    note =
      data.profile.goal === 'gain'
        ? `${display} is faster than a lean gain. Check body fat — some of this is likely fat.`
        : `${display} is above the band.`;
  }
  // While creatine is saturating, the scale is carrying water that is not fat.
  // Reporting this as pass/fail would either credit a stall as progress or, on a
  // cut, call a perfectly good week a failure — so it drops to context until the
  // water has landed and the slope means something again.
  if (creatineConfounds(data, win[0]!.date, win[win.length - 1]!.date)) {
    return {
      id, name, status: 'info', display, value, band: band.label,
      note: `${display} over ${spanDays} days, but you started creatine inside this window. Creatine pulls water into muscle — expect 1-2 kg on the scale that is not fat. Judge the next few weeks on waist and body fat, not weight.`,
      series: win.map((p) => p.v), priority: 100,
    };
  }
  return { id, name, status, display, value, band: band.label, note, series: win.map((p) => p.v), priority: 100 };
}

export function proteinTarget(data: AppData, end: string): TargetResult {
  const id = 'protein';
  const name = 'Protein';
  const kg = currentWeight(data);
  const band = kg ? `${(1.6 * kg).toFixed(0)}–${(2.2 * kg).toFixed(0)} g/day` : '1.6–2.2 g/kg';
  const win = proteinWindow(data, 7, end);

  if (!kg) return nodata(id, name, band, 'Needs a bodyweight before a protein target exists.', 80);
  if (win.length < 4) {
    return nodata(id, name, band, `Only ${win.length} of the last 7 days logged. Log 4+ to judge this.`, 80);
  }
  const avg = mean(win.map((p) => p.v))!;
  const value = Math.round(avg);
  const lo = 1.6 * kg;
  const hi = 2.2 * kg;
  const display = `${value} g/day`;

  let status: TargetStatus = 'in';
  let note = `Averaging ${value} g over ${win.length} logged days — right where it should be.`;
  if (avg < lo) {
    status = 'low';
    note = `${value} g/day is under ${lo.toFixed(0)} g. Protein is the most common thing missing from a stalled gain.`;
  } else if (avg > hi) {
    status = 'high';
    note = `${value} g/day is more than you need; the extra calories are better spent elsewhere.`;
  }
  return { id, name, status, display, value, band, note, series: win.map((p) => p.v), priority: 80 };
}

export interface MaintenanceEstimate {
  kcal: number;
  /** 'empirical' is derived from your own intake vs weight trend; 'formula' is a cold-start guess. */
  basis: 'empirical' | 'formula';
}

/**
 * Maintenance calories.
 *
 * Preference is always for the empirical estimate: over a window, whatever you
 * ate minus whatever your weight trend says you banked *is* your maintenance,
 * measured on you rather than assumed from a population formula. It also makes
 * the whole thing robust to photo-estimate bias — if every meal reads 15% low,
 * maintenance comes out 15% low too and the surplus you're steering by is still
 * right.
 */
export function estimateMaintenance(data: AppData, end: string): MaintenanceEstimate | null {
  const intake = intakeWindow(data, 28, end);
  const weights = windowOf(
    allWeights(data).map((w) => ({ date: w.date, v: w.kg })),
    28,
    end,
  );
  // Needs a fortnight's worth of logged days and a real weight trend to mean anything.
  if (intake.length >= 14 && weights.length >= 3 && daysBetween(weights[0]!.date, weights[weights.length - 1]!.date) >= 14) {
    // Creatine saturation is the one thing that breaks this derivation outright.
    // Maintenance here is `intake − slope × 7700`, so water weight enters the
    // estimate as though it were banked energy: a false +1.5 kg over 28 days is
    // a slope of 0.054 kg/day, which is ~410 kcal/day of energy that was never
    // eaten. The estimate would come back that much too high and quietly hand
    // back the entire deficit. A formula estimate is worse in general and far
    // better here, because it does not read the scale at all.
    const confounded = creatineConfounds(data, weights[0]!.date, weights[weights.length - 1]!.date);
    const perDay = slopePerDay(weights);
    const avgIntake = mean(intake.map((p) => p.v));
    if (!confounded && perDay != null && avgIntake != null) {
      return { kcal: Math.round(avgIntake - perDay * KCAL_PER_KG), basis: 'empirical' };
    }
  }

  // Cold start: Mifflin-St Jeor plus measured active energy beats a guessed
  // activity multiplier, since Apple Health already knows what you burned.
  const { heightCm, age, sex } = data.profile;
  const kg = currentWeight(data);
  if (kg && heightCm && age && sex) {
    const bmr = 10 * kg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
    const aen = mean(windowOf(healthSeries(data, 'aen'), 14, end).map((p) => p.v)) ?? 0;
    // 1.1 covers the thermic effect of food and non-tracked movement.
    return { kcal: Math.round(bmr * 1.1 + aen), basis: 'formula' };
  }
  return null;
}

/**
 * Daily calorie surplus implied by the weight band, rather than a folk figure.
 *
 * These two targets have to agree or they send you in different directions: the
 * usual "+250 kcal to bulk" works out to roughly 1 kg a month, which is *above*
 * the +0.25–0.5 kg band this app is steering by. Deriving the surplus from the
 * band's midpoint keeps one source of truth — change the band and the calorie
 * advice follows.
 */
export function surplusFor(data: AppData): number {
  const band = weightBand(data);
  const midKgPerMonth = (band.lo + band.hi) / 2;
  return Math.round((midKgPerMonth * KCAL_PER_KG) / DAYS_PER_MONTH);
}

/**
 * Tolerance around the intake target, in kcal/day.
 *
 * Wide enough not to chase noise in a 14-day mean of photo estimates, narrow
 * enough that the band still means something next to a ~95 kcal surplus.
 */
/**
 * Tolerance around the intake target, in kcal/day.
 *
 * Scaled to the surplus rather than fixed: a flat 125 kcal would be wider than
 * the ~95 kcal surplus a lean gain actually calls for, which would make the
 * target incapable of ever flagging the most common failure — eating at
 * maintenance and wondering why nothing is happening. The floor keeps it from
 * chasing noise when the surplus is near zero.
 */
export function energyTolerance(surplus: number): number {
  return Math.max(75, Math.abs(surplus) * 0.6);
}

export function energyTarget(data: AppData, end: string): TargetResult {
  const id = 'energy';
  const name = 'Energy balance';
  const maint = estimateMaintenance(data, end);
  const surplus = surplusFor(data);
  const tol = energyTolerance(surplus);
  const band = maint
    ? `${Math.round(maint.kcal + surplus - tol)}–${Math.round(maint.kcal + surplus + tol)} kcal/day`
    : `maintenance ${surplus >= 0 ? '+' : ''}${surplus} kcal`;

  const win = intakeWindow(data, 14, end);
  if (!maint) {
    return nodata(
      id,
      name,
      band,
      'Needs ~2 weeks of logged meals and weigh-ins, or your height/age/sex in settings for a starting estimate.',
      90,
    );
  }
  if (win.length < 8) {
    return nodata(id, name, band, `Only ${win.length} of the last 14 days logged. Log 8+ to judge this.`, 90);
  }

  const avg = mean(win.map((p) => p.v))!;
  const value = Math.round(avg);
  const target = maint.kcal + surplus;
  const diff = Math.round(avg - target);
  const display = `${value} kcal/day`;

  // When maintenance is derived from your own intake and weight trend, this
  // target is algebraically the weight trend restated in calories — the two
  // cannot disagree. Counting it as an independent check would score the same
  // evidence twice, so it reports as context: valuable because it converts a
  // slope into an amount of food, not because it is separate proof.
  if (maint.basis === 'empirical') {
    const advice =
      Math.abs(diff) <= tol
        ? `Averaging ${value} kcal/day, which is holding the trend where you want it.`
        : diff < 0
          ? `Averaging ${value} kcal/day. Your weight trend puts that ${Math.abs(diff)} kcal/day short — add about that much.`
          : `Averaging ${value} kcal/day, roughly ${diff} kcal/day more than the band needs. Trim it or expect fat with the gain.`;
    return {
      id, name, status: 'info', display, value, band,
      note: `${advice} (Maintenance ≈ ${maint.kcal} kcal, measured from your own intake against your weight trend.)`,
      series: win.map((p) => p.v), priority: 90,
    };
  }

  // Formula maintenance is independent of what you logged eating, so here the
  // comparison is real evidence and can pass or fail on its own.
  let status: TargetStatus = 'in';
  let note = `Averaging ${value} kcal against a ${Math.round(target)} target.`;
  if (diff < -tol) {
    status = 'low';
    note = `${Math.abs(diff)} kcal/day under target. Add roughly that much.`;
  } else if (diff > tol) {
    status = 'high';
    note = `${diff} kcal/day over target. Trim it back or expect fat with the gain.`;
  }
  note += ` (Maintenance ≈ ${maint.kcal} kcal, estimated from your height, age and measured activity — it sharpens into a measured figure once you have a fortnight of meals and weigh-ins.)`;
  return { id, name, status, display, value, band, note, series: win.map((p) => p.v), priority: 90 };
}

export function leanQualityTarget(data: AppData, end: string): TargetResult {
  const id = 'lean';
  const name = 'Lean-gain quality';
  const band = 'fat < 50% of gain';
  // Days where we know both weight and body fat, so fat and lean mass split out.
  const pts = Object.entries(data.health.days)
    .filter(([d, day]) => d <= end && day.wt != null && day.bf != null)
    .map(([date, day]) => ({ date, wt: day.wt!, bf: day.bf! }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (pts.length < 2 || daysBetween(pts[0]!.date, pts[pts.length - 1]!.date) < 14) {
    return nodata(id, name, band, 'Needs body-fat readings 14+ days apart — a smart scale gives you this.', 60);
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const dWeight = last.wt - first.wt;
  const fatFirst = (first.wt * first.bf) / 100;
  const fatLast = (last.wt * last.bf) / 100;
  const dFat = fatLast - fatFirst;

  if (Math.abs(dWeight) < 0.3) {
    return nodata(id, name, band, 'Weight has barely moved, so there is no gain to split yet.', 60);
  }
  if (dWeight < 0) {
    const value = Math.round((dFat / dWeight) * 100);
    return {
      id, name, status: 'info',
      display: `${dWeight.toFixed(1)} kg`, value,
      band,
      note: `Down ${Math.abs(dWeight).toFixed(1)} kg overall — the lean-gain split doesn't apply while weight is falling.`,
      series: pts.map((p) => p.wt), priority: 60,
    };
  }
  const share = dFat / dWeight;
  const value = Math.round(share * 100);
  const display = `${value}% fat`;
  const status: TargetStatus = share < 0.5 ? 'in' : 'high';
  const note =
    share < 0.5
      ? `Of ${dWeight.toFixed(1)} kg gained, ${value}% is fat — that's a lean gain.`
      : `Of ${dWeight.toFixed(1)} kg gained, ${value}% is fat. Slow the surplus down.`;
  return { id, name, status, display, value, band, note, series: pts.map((p) => p.wt), priority: 60 };
}

export function frequencyTarget(data: AppData, end: string): TargetResult {
  const id = 'freq';
  const name = 'Training frequency';
  const band = '≥ 4 sessions/week';
  const from = shiftDate(end, -6);
  const week = data.sessions.filter((s) => s.date >= from && s.date <= end);
  // Core days are logged and rewarded, but they are not one of the four —
  // otherwise three sessions plus an ab session reads as a full week.
  const logged = week.filter(isFullSession).length;
  const coreDays = week.length - logged;
  const healthWorkouts = windowOf(healthSeries(data, 'wo'), 7, end).reduce((a, p) => a + p.v, 0);

  let note =
    logged >= 4
      ? `${logged} sessions in the last 7 days. On plan.`
      : `${logged} of 4 sessions this week. The plan only works if the sessions happen.`;
  if (coreDays) {
    note += ` Plus ${coreDays} core ${coreDays === 1 ? 'day' : 'days'}, which don't count toward the four.`;
  }
  // Cross-check: Health knowing about workouts you never logged is worth saying.
  // Compared against everything logged, core days included — a core day is a
  // workout as far as the watch is concerned.
  if (healthWorkouts > week.length) {
    note += ` Apple Health recorded ${healthWorkouts} workouts — you may have sessions left unlogged.`;
  }
  return {
    id, name,
    status: logged >= 4 ? 'in' : 'low',
    display: `${logged}/week`, value: logged, band, note,
    series: [], priority: 85,
  };
}

/** Trailing mean vs the baseline immediately before it. */
function recentVsBaseline(
  series: DatedValue[],
  end: string,
  recentDays: number,
  baselineDays: number,
): { recent: number; baseline: number } | null {
  const recent = mean(windowOf(series, recentDays, end).map((p) => p.v));
  const baseEnd = shiftDate(end, -recentDays);
  const base = mean(windowOf(series, baselineDays, baseEnd).map((p) => p.v));
  if (recent == null || base == null) return null;
  return { recent, baseline: base };
}

export function recoveryTarget(data: AppData, end: string): TargetResult {
  const id = 'recovery';
  const name = 'Recovery';
  const band = 'RHR ≤ +5%, HRV ≥ −10%';
  const rhr = recentVsBaseline(healthSeries(data, 'rhr'), end, 7, 28);
  const hrv = recentVsBaseline(healthSeries(data, 'hrv'), end, 7, 28);

  if (!rhr && !hrv) {
    return nodata(id, name, band, 'Needs a few weeks of resting heart rate or HRV from your watch.', 70);
  }
  const rhrDelta = rhr ? (rhr.recent - rhr.baseline) / rhr.baseline : null;
  const hrvDelta = hrv ? (hrv.recent - hrv.baseline) / hrv.baseline : null;

  const flags: string[] = [];
  if (rhrDelta != null && rhrDelta > 0.05) flags.push(`resting HR up ${(rhrDelta * 100).toFixed(0)}%`);
  if (hrvDelta != null && hrvDelta < -0.1) flags.push(`HRV down ${Math.abs(hrvDelta * 100).toFixed(0)}%`);

  const parts: string[] = [];
  if (rhr) parts.push(`RHR ${rhr.recent.toFixed(0)}`);
  if (hrv) parts.push(`HRV ${hrv.recent.toFixed(0)}`);
  const display = parts.join(' · ');

  if (flags.length) {
    // A stimulant raises resting heart rate and suppresses HRV directly — the
    // same fingerprint this target reads as accumulated fatigue. Telling you to
    // take an easy week when the cause is a pre-workout would cost training for
    // nothing, so the dose count goes in the note and you decide.
    const stims = dosesOfKind(data, 'stimulant', shiftDate(end, -6), end).length;
    const caveat = stims
      ? ` You logged ${stims} stimulant dose${stims === 1 ? '' : 's'} this week — caffeine moves both of these numbers on its own, so some of this is the supplement rather than your training.`
      : '';
    return {
      id, name, status: 'high',
      display, value: rhrDelta != null ? Math.round(rhrDelta * 100) : null, band,
      note: `${flags.join(' and ')} against your own baseline. Usually sleep, stress, or too much training — take an easy week.${caveat}`,
      series: windowOf(healthSeries(data, 'rhr'), 28, end).map((p) => p.v),
      priority: 75,
    };
  }
  return {
    id, name, status: 'in',
    display, value: rhrDelta != null ? Math.round(rhrDelta * 100) : null, band,
    note: 'Resting heart rate and HRV are both steady against your baseline. Recovery is keeping up.',
    series: windowOf(healthSeries(data, 'rhr'), 28, end).map((p) => p.v),
    priority: 75,
  };
}

export function sleepTarget(data: AppData, end: string): TargetResult {
  const id = 'sleep';
  const name = 'Sleep';
  const band = '≥ 7 h/night';
  const win = windowOf(healthSeries(data, 'sleep'), 7, end);
  if (win.length < 3) return nodata(id, name, band, 'Needs sleep tracking on at least 3 of the last 7 nights.', 65);
  const avg = mean(win.map((p) => p.v))!;
  const value = Math.round(avg * 10) / 10;
  const display = `${value.toFixed(1)} h`;
  const status: TargetStatus = avg >= 7 ? 'in' : 'low';
  // Caffeine's half-life is five to six hours, so an afternoon pre-workout still
  // has half its load on board at bedtime. When sleep is short and late doses
  // exist, that is the first thing to try moving.
  const late = status === 'low' ? lateStimulantDoses(data, shiftDate(end, -6), end).length : 0;
  const lateNote = late
    ? ` ${late} of your stimulant dose${late === 1 ? ' was' : 's were'} taken after 16:00 — caffeine is still half on board six hours later. Move it earlier before changing anything else.`
    : '';
  return {
    id, name, status, display, value, band,
    note:
      status === 'in'
        ? `${display} a night across ${win.length} nights. Enough to recover on.`
        : `${display} a night. Under 7 h blunts both recovery and the gain — this is the cheapest fix on this page.${lateNote}`,
    series: win.map((p) => p.v), priority: 65,
  };
}

export function activityTarget(data: AppData, end: string): TargetResult {
  const id = 'activity';
  const name = 'Activity load';
  const band = 'context';
  const steps = recentVsBaseline(healthSeries(data, 'steps'), end, 7, 28);
  const aen = recentVsBaseline(healthSeries(data, 'aen'), end, 7, 28);
  if (!steps && !aen) return nodata(id, name, band, 'Needs step or active-energy history.', 20);

  const stepDelta = steps ? (steps.recent - steps.baseline) / steps.baseline : null;
  const display = steps ? `${Math.round(steps.recent).toLocaleString()} steps/day` : `${Math.round(aen!.recent)} kcal/day`;
  const pct = stepDelta != null ? Math.round(stepDelta * 100) : null;

  let note = 'Activity is level with your recent baseline.';
  if (pct != null && Math.abs(pct) >= 15) {
    note =
      pct > 0
        ? `Moving ${pct}% more than your baseline — that burns into the surplus and can explain a stalled weight trend.`
        : `Moving ${Math.abs(pct)}% less than your baseline, so the same intake goes further than it did.`;
  }
  return {
    id, name, status: 'info', display, value: pct, band, note,
    series: windowOf(healthSeries(data, 'steps'), 28, end).map((p) => p.v),
    priority: 20,
  };
}

/* ------------------------------------------------------------------ */

export function evaluateTargets(data: AppData, end: string = todayISO()): Verdict {
  const results = [
    weightTrendTarget(data, end),
    energyTarget(data, end),
    frequencyTarget(data, end),
    proteinTarget(data, end),
    recoveryTarget(data, end),
    sleepTarget(data, end),
    leanQualityTarget(data, end),
    activityTarget(data, end),
  ];

  const judgeable = results.filter((r) => r.status !== 'nodata' && r.status !== 'info');
  const inCount = judgeable.filter((r) => r.status === 'in').length;
  const worst = judgeable
    .filter((r) => r.status !== 'in')
    .sort((a, b) => b.priority - a.priority)[0];

  return {
    results,
    inCount,
    judgeable: judgeable.length,
    headline: worst ? worst.note : null,
  };
}
