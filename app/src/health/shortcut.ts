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

/**
 * Parse and validate a Shortcut payload.
 *
 * Fails loudly on a wrong tag or version: a Shortcut left on an old contract
 * should tell you so, not silently write nothing.
 */
export function parseShortcutPayload(text: string): ShortcutPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HealthImportError("That isn't valid JSON.");
  }
  if (!raw || typeof raw !== 'object') throw new HealthImportError('Expected a JSON object.');
  const o = raw as Partial<ShortcutPayload>;

  if (o.t !== SHORTCUT_PAYLOAD_TAG) {
    throw new HealthImportError(`Not a health payload (expected t="${SHORTCUT_PAYLOAD_TAG}").`);
  }
  if (o.v !== SHORTCUT_PAYLOAD_VERSION) {
    throw new HealthImportError(
      `Shortcut is on payload v${o.v ?? '?'}, this app expects v${SHORTCUT_PAYLOAD_VERSION}. Update the Shortcut.`,
    );
  }
  if (!Array.isArray(o.days)) throw new HealthImportError('Payload has no "days" array.');

  const days: ShortcutDay[] = [];
  for (const entry of o.days) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.d !== 'string' || !ISO_DATE.test(e.d)) continue;
    const day: ShortcutDay = { d: e.d };
    for (const f of NUMERIC_FIELDS) {
      const v = e[f];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const [lo, hi] = BOUNDS[f];
      if (v < lo || v > hi) continue;
      day[f] = v;
    }
    days.push(day);
  }
  if (!days.length) throw new HealthImportError('No usable days in that payload.');
  return { t: o.t, v: o.v, days };
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
