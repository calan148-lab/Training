import { LADDERS, PLAN, RANKS } from './plan';
import type { AppData, LadderKey, SessionRecord, SessionType, WeightEntry } from './types';

const WEEK_MS = 6.048e8;

/** Whole weeks elapsed since a start date, floored. */
function weeksSince(startISO: string, dateISO: string): number {
  return Math.floor((new Date(dateISO).getTime() - new Date(startISO).getTime()) / WEEK_MS);
}

/** 1-based week of the 8-week block. */
export function weekNo(d: AppData, now: Date = new Date()): number {
  const w = weeksSince(d.start, now.toISOString().slice(0, 10)) + 1;
  return Math.min(8, Math.max(1, w));
}

/** Scheduled session for a date, or '' for a rest day. */
export function planFor(d: AppData, dateISO: string): SessionType | '' {
  const wk = weeksSince(d.start, dateISO);
  const dow = (new Date(dateISO).getDay() + 6) % 7; // Monday = 0
  const row = PLAN[Math.max(0, wk) % 2]!;
  return (row[dow] ?? '') as SessionType | '';
}

export function bestPull(d: AppData): number {
  return Math.max(0, ...d.sessions.flatMap((s) => (s.best?.pullup ? [s.best.pullup] : [])));
}

export function bestRounds(d: AppData): number {
  return Math.max(0, ...d.sessions.filter((s) => s.type === 'C').map((s) => s.rounds ?? 0));
}

export function rungsClimbed(d: AppData): number {
  return Object.values(d.ladders).reduce((a, b) => a + b, 0);
}

/**
 * A full training session, as opposed to a core day.
 *
 * The four-a-week target is about spreading real stimulus across the week. A
 * 20-minute core session is worth doing and worth logging, but three sessions
 * plus a core day is three sessions — counting it as the fourth would let the
 * target report "on plan" for a week that wasn't.
 */
export function isFullSession(s: SessionRecord): boolean {
  return s.type !== 'D';
}

/**
 * Sessions per block-week, keyed by 0-based week index. Pass a predicate to
 * count only some of them — `isFullSession` for anything judging the plan.
 */
export function weekBuckets(
  d: AppData,
  include: (s: SessionRecord) => boolean = () => true,
): Record<number, number> {
  const b: Record<number, number> = {};
  for (const s of d.sessions) {
    if (!include(s)) continue;
    const w = weeksSince(d.start, s.date);
    b[w] = (b[w] ?? 0) + 1;
  }
  return b;
}

/** Best week by full sessions — what the '4 sessions in one week' badge means. */
export function maxWeekCount(d: AppData): number {
  return Math.max(0, ...Object.values(weekBuckets(d, isFullSession)));
}

/** Everything logged this week, core days included — a plain counter, not a judgement. */
export function thisWeekCount(d: AppData): number {
  return weekBuckets(d)[weekNo(d) - 1] ?? 0;
}

/**
 * Every weigh-in we know about — manual entries plus Apple Health body-mass
 * readings — deduped by date, Health winning since a scale beats a typed number.
 * Sorted oldest first.
 */
export function allWeights(d: AppData): WeightEntry[] {
  const byDate = new Map<string, number>();
  for (const w of d.weights) byDate.set(w.date, w.kg);
  for (const [date, day] of Object.entries(d.health.days)) {
    if (day.wt != null) byDate.set(date, day.wt);
  }
  return [...byDate.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * XP.
 *
 * Weigh-ins are capped at one scoring day per week. Without the cap, importing
 * two years of Apple Health body-mass readings would award ~700 weigh-ins and
 * vault straight to the top rank on the strength of an import — rank is meant
 * to track work done inside the block, and history you already lived isn't that.
 */
export function calcXP(d: AppData): number {
  let xp = 0;
  // A core day is a fraction of the work of a full session and is paid as one,
  // so that adding core days can't out-earn actually training.
  for (const s of d.sessions) xp += s.type === 'C' ? 80 : s.type === 'D' ? 50 : 100;
  xp += rungsClimbed(d) * 250;

  const weighWeeks = new Set(allWeights(d).map((w) => weeksSince(d.start, w.date)));
  xp += weighWeeks.size * 25;

  for (const c of Object.values(weekBuckets(d, isFullSession))) if (c >= 4) xp += 200;
  const bp = bestPull(d);
  if (bp) xp += bp * 15;
  return xp;
}

export function rankOf(xp: number) {
  let i = 0;
  RANKS.forEach((r, j) => {
    if (xp >= r.xp) i = j;
  });
  return { i, r: RANKS[i]!, next: RANKS[i + 1] ?? null };
}

export interface Badge {
  id: string;
  n: string;
  d: string;
  t: (d: AppData) => boolean;
}

export const BADGES: Badge[] = [
  { id: 'first', n: 'First Blood', d: 'Log your first session', t: (d) => d.sessions.length >= 1 },
  { id: 'week1', n: 'Full Week', d: '4 sessions in one week', t: (d) => maxWeekCount(d) >= 4 },
  { id: 'pull', n: 'Full Pull', d: 'Reach the full pull-up rung', t: (d) => d.ladders.pullup >= 3 },
  { id: 'ten', n: 'Ten Up', d: '10 pull-ups in a single set', t: (d) => bestPull(d) >= 10 },
  { id: 'ascend', n: 'Ascender', d: 'Climb 5 rungs total', t: (d) => rungsClimbed(d) >= 5 },
  { id: 'hand', n: 'Inverted', d: 'Reach the wall handstand rung', t: (d) => d.ladders.pike >= 3 },
  { id: 'circuit', n: 'Circuit Breaker', d: '14+ rounds in the 20-min circuit', t: (d) => bestRounds(d) >= 14 },
  { id: 'fed', n: 'Well Fed', d: '8 weigh-ins logged', t: (d) => allWeights(d).length >= 8 },
  {
    id: 'grow',
    n: 'Growing',
    d: '+1 kg since your first weigh-in',
    t: (d) => {
      const w = allWeights(d);
      return w.length > 1 && w[w.length - 1]!.kg - w[0]!.kg >= 1;
    },
  },
  { id: 'twenty', n: 'Twenty Deep', d: '20 sessions logged', t: (d) => d.sessions.length >= 20 },
  { id: 'finish', n: 'Eight Weeks', d: 'Reach week 8', t: (d) => weekNo(d) >= 8 },
];

/** Badges newly earned but not yet acknowledged. */
export function newBadges(d: AppData): Badge[] {
  return BADGES.filter((b) => !d.seen.includes(b.id) && b.t(d));
}

export function ladderName(k: LadderKey): string {
  return LADDERS[k].name;
}
