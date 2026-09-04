import type { AppData, HealthDay, HealthSource } from '../domain/types';

/** Payload version the Shortcut must emit. Bumped only on a breaking change. */
export const SHORTCUT_PAYLOAD_TAG = 'health8w';
export const SHORTCUT_PAYLOAD_VERSION = 1;

export interface ShortcutDay extends HealthDay {
  d: string;
}

export interface ShortcutPayload {
  t: string;
  v: number;
  days: ShortcutDay[];
}

export class HealthImportError extends Error {}

const NUMERIC_FIELDS = ['wt', 'bf', 'rhr', 'hrv', 'sleep', 'steps', 'aen', 'wo'] as const;

/** Plausibility bounds — a Shortcut misconfigured to emit grams, or a stray 0, should not poison the trend. */
const BOUNDS: Record<(typeof NUMERIC_FIELDS)[number], [number, number]> = {
  wt: [20, 400],
  bf: [1, 70],
  rhr: [25, 150],
  hrv: [1, 400],
  sleep: [0, 24],
  steps: [0, 200000],
  aen: [0, 20000],
  wo: [0, 20],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce one raw entry into a validated day, or null if it has no usable date. */
function readDay(entry: unknown): ShortcutDay | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.d !== 'string' || !ISO_DATE.test(e.d)) return null;
  const day: ShortcutDay = { d: e.d };
  for (const f of NUMERIC_FIELDS) {
    const v = e[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = BOUNDS[f];
    if (v < lo || v > hi) continue;
    day[f] = v;
  }
  return day;
}

/**
 * Parse and validate a Shortcut payload.
 *
 * Three shapes are accepted, because every action you have to add by hand in
 * Shortcuts is another chance to get it wrong: the full wrapper, a bare array
 * of days, or a single day object.
 *
 * The version check only applies when the wrapper is actually present — it
 * exists so a Shortcut left on an old contract fails loudly rather than
 * silently writing nothing, and a bare array makes no claim to check.
 */
export function parseShortcutPayload(text: string): ShortcutPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HealthImportError("That isn't valid JSON.");
  }
  if (!raw || typeof raw !== 'object') {
    throw new HealthImportError('Expected a JSON object or array of days.');
  }

  let entries: unknown[];

  if (Array.isArray(raw)) {
    entries = raw;
  } else {
    const o = raw as Partial<ShortcutPayload> & Record<string, unknown>;
    if (o.t !== undefined || o.v !== undefined) {
      // A wrapper that names itself must name itself correctly.
      if (o.t !== SHORTCUT_PAYLOAD_TAG) {
        throw new HealthImportError(`Not a health payload (expected t="${SHORTCUT_PAYLOAD_TAG}").`);
      }
      if (o.v !== SHORTCUT_PAYLOAD_VERSION) {
        throw new HealthImportError(
          `Shortcut is on payload v${o.v ?? '?'}, this app expects v${SHORTCUT_PAYLOAD_VERSION}. Update the Shortcut.`,
        );
      }
    }
    if (Array.isArray(o.days)) entries = o.days;
    else if (typeof o.d === 'string') entries = [o];
    else throw new HealthImportError('Payload has no "days" array.');
  }

  const days = entries.map(readDay).filter((d): d is ShortcutDay => d !== null);
  if (!days.length) throw new HealthImportError('No usable days in that payload.');
  return { t: SHORTCUT_PAYLOAD_TAG, v: SHORTCUT_PAYLOAD_VERSION, days };
}

/**
 * Parse several files at once and pool their days.
 *
 * Later files win on conflict, matching the merge order. Files that fail to
 * parse are reported rather than silently dropped, so picking a stray file
 * alongside good ones tells you which one was wrong.
 */
export function parseShortcutFiles(texts: string[]): { days: ShortcutDay[]; errors: string[] } {
  const days: ShortcutDay[] = [];
  const errors: string[] = [];
  for (const text of texts) {
    try {
      days.push(...parseShortcutPayload(text).days);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { days, errors };
}

/**
 * How an import would land: days not seen before, versus days already stored.
 *
 * Re-importing an overlapping window is harmless and expected — the Shortcut
 * emits a trailing window so a missed day heals itself — but it should be
 * visible that eight days arrived and only one was new.
 */
export function diffHealthDays(
  data: AppData,
  incoming: Array<{ d: string } & HealthDay>,
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const { d } of incoming) {
    if (seen.has(d)) continue;
    seen.add(d);
    if (data.health.days[d]) updated++;
    else added++;
  }
  return { added, updated };
}

/**
 * Merge day rollups into app state, field by field.
 *
 * A key absent from the incoming day never clears a stored value — a Shortcut
 * that skips body fat on days you didn't step on the scale must not erase the
 * body-fat history it isn't reporting on.
 */
export function mergeHealthDays(
  data: AppData,
  incoming: Array<{ d: string } & HealthDay>,
  src: HealthSource,
  now: Date = new Date(),
): AppData {
  const days = { ...data.health.days };
  for (const { d, ...fields } of incoming) {
    const prev = days[d] ?? {};
    const next: HealthDay = { ...prev };
    for (const [k, v] of Object.entries(fields)) {
      if (v == null || !Number.isFinite(v as number)) continue;
      next[k as keyof HealthDay] = v as number;
    }
    days[d] = next;
  }
  return {
    ...data,
    health: { lastSync: now.toISOString(), src, days },
  };
}
