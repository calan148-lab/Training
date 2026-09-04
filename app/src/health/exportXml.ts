import type { HealthDay } from '../domain/types';

/**
 * Streaming parser for Apple Health's `export.xml`.
 *
 * Real exports run to hundreds of megabytes and hundreds of thousands of
 * `<Record>` elements, so this never builds a DOM and never holds the file in
 * memory: it consumes decoded text chunk by chunk, folds each record straight
 * into a per-day accumulator, and keeps only a small tail buffer across chunk
 * boundaries.
 */

/**
 * One device's contribution to one day.
 *
 * Totals are accumulated per source rather than pooled, because a phone, a
 * watch and a ring all write the same metrics to Health and the raw export
 * contains every one of their records. Summing across sources double-counts:
 * two devices tracking one night produced 16 hours of sleep, and one hour of
 * walking produced 15,800 steps. Health's own UI hides this by picking a
 * source per data type; the export does not.
 */
interface SourceAcc {
  /** Latest-timestamp-wins fields. */
  wt?: { v: number; ts: number };
  bf?: { v: number; ts: number };
  /** Mean fields, kept with their sample count so a source can be ranked. */
  rhr?: { sum: number; n: number };
  hrv?: { sum: number; n: number };
  /** Summed within this source only. */
  steps?: number;
  aen?: number;
  sleep?: number;
  wo?: number;
}

/** sourceName -> that source's totals for the day. */
type DayAcc = Map<string, SourceAcc>;

const TYPE_BODY_MASS = 'HKQuantityTypeIdentifierBodyMass';
const TYPE_BODY_FAT = 'HKQuantityTypeIdentifierBodyFatPercentage';
const TYPE_STEPS = 'HKQuantityTypeIdentifierStepCount';
const TYPE_ACTIVE_ENERGY = 'HKQuantityTypeIdentifierActiveEnergyBurned';
const TYPE_RESTING_HR = 'HKQuantityTypeIdentifierRestingHeartRate';
const TYPE_HRV = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN';
const TYPE_SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';

const WANTED = new Set([
  TYPE_BODY_MASS,
  TYPE_BODY_FAT,
  TYPE_STEPS,
  TYPE_ACTIVE_ENERGY,
  TYPE_RESTING_HR,
  TYPE_HRV,
  TYPE_SLEEP,
]);

const TAG_RE = /<(Record|Workout)\s([^>]*?)\/?>/g;
const ATTR_RE = /([A-Za-z]+)="([^"]*)"/g;

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s))) out[m[1]!] = m[2]!;
  return out;
}

/** Health writes `2026-08-31 08:12:03 +0200`; the first 10 chars are the device-local date. */
function localDate(stamp: string | undefined): string | null {
  if (!stamp || stamp.length < 10) return null;
  const d = stamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Parse Health's timestamp format into epoch millis. */
export function parseStamp(stamp: string | undefined): number | null {
  if (!stamp) return null;
  // "2026-08-31 08:12:03 +0200" -> "2026-08-31T08:12:03+02:00"
  const iso = stamp.replace(' ', 'T').replace(/\s([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function toKg(value: number, unit: string | undefined): number {
  if (unit === 'lb') return value * 0.45359237;
  if (unit === 'st') return value * 6.35029318;
  return value;
}

function toKcal(value: number, unit: string | undefined): number {
  if (unit === 'kJ') return value / 4.184;
  return value;
}

export class HealthExportAccumulator {
  private days = new Map<string, DayAcc>();
  private buf = '';
  /** Records actually folded in, for the "imported N records" line. */
  records = 0;

  /** The accumulator for one day and one source, created on demand. */
  private bucket(d: string, source: string): SourceAcc {
    let day = this.days.get(d);
    if (!day) {
      day = new Map();
      this.days.set(d, day);
    }
    let acc = day.get(source);
    if (!acc) {
      acc = {};
      day.set(source, acc);
    }
    return acc;
  }

  /** Feed one decoded chunk. Safe to call with arbitrary split points. */
  push(chunk: string): void {
    this.buf += chunk;
    // Any tag left mid-write starts at a '<' with no '>' after it; keep from there.
    const cut = this.buf.lastIndexOf('<');
    let processable: string;
    if (cut >= 0 && this.buf.indexOf('>', cut) === -1) {
      processable = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut);
    } else {
      processable = this.buf;
      this.buf = '';
    }
    this.scan(processable);
  }

  /** Flush whatever remains in the tail buffer. */
  end(): void {
    if (this.buf) {
      this.scan(this.buf);
      this.buf = '';
    }
  }

  private scan(text: string): void {
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text))) {
      const tag = m[1]!;
      const body = m[2]!;
      if (tag === 'Workout') {
        this.workout(body);
        continue;
      }
      // Cheap pre-filter: skip the ~95% of records we don't want before
      // paying for full attribute parsing.
      const t = /type="([^"]+)"/.exec(body)?.[1];
      if (!t || !WANTED.has(t)) continue;
      this.record(t, body);
    }
  }

  private workout(body: string): void {
    const a = attrs(body);
    const d = localDate(a.startDate);
    if (!d) return;
    const acc = this.bucket(d, a.sourceName ?? 'unknown');
    acc.wo = (acc.wo ?? 0) + 1;
    this.records++;
  }

  private record(type: string, body: string): void {
    const a = attrs(body);

    if (type === TYPE_SLEEP) {
      // Only genuine sleep stages count; "InBed" and "Awake" do not.
      if (!/Asleep/.test(a.value ?? '')) return;
      const start = parseStamp(a.startDate);
      const end = parseStamp(a.endDate);
      if (start == null || end == null || end <= start) return;
      // Attribute a sleep block to the day you woke, matching how Health reports it.
      const d = localDate(a.endDate);
      if (!d) return;
      const acc = this.bucket(d, a.sourceName ?? 'unknown');
      acc.sleep = (acc.sleep ?? 0) + (end - start) / 3.6e6;
      this.records++;
      return;
    }

    const value = Number(a.value);
    if (!Number.isFinite(value)) return;
    const d = localDate(a.startDate);
    if (!d) return;
    const acc = this.bucket(d, a.sourceName ?? 'unknown');
    const ts = parseStamp(a.startDate) ?? 0;

    switch (type) {
      case TYPE_BODY_MASS: {
        const kg = toKg(value, a.unit);
        if (!acc.wt || ts >= acc.wt.ts) acc.wt = { v: kg, ts };
        break;
      }
      case TYPE_BODY_FAT: {
        // HealthKit stores this as a fraction (0.142 = 14.2%); some sources
        // write whole percents. Anything at or below 1 is a fraction —
        // nobody carries 1% body fat.
        const pct = value <= 1 ? value * 100 : value;
        if (!acc.bf || ts >= acc.bf.ts) acc.bf = { v: pct, ts };
        break;
      }
      case TYPE_STEPS:
        acc.steps = (acc.steps ?? 0) + value;
        break;
      case TYPE_ACTIVE_ENERGY:
        acc.aen = (acc.aen ?? 0) + toKcal(value, a.unit);
        break;
      case TYPE_RESTING_HR: {
        const r = acc.rhr ?? { sum: 0, n: 0 };
        r.sum += value;
        r.n++;
        acc.rhr = r;
        break;
      }
      case TYPE_HRV: {
        const h = acc.hrv ?? { sum: 0, n: 0 };
        h.sum += value;
        h.n++;
        acc.hrv = h;
        break;
      }
    }
    this.records++;
  }

  /**
   * Collapse accumulators into day rollups, resolving multiple sources.
   *
   * Totals (steps, active energy, sleep, workouts) take the largest single
   * source rather than adding sources together. Adding them is what produced
   * a 16-hour night from two devices watching one sleep; the largest source
   * is the most complete record of what actually happened, and can never
   * exceed reality the way a sum does.
   *
   * Averages (resting HR, HRV) take the source with the most samples that day
   * rather than blending devices. A phone and a ring measure resting heart
   * rate differently, and averaging them invents a figure neither reported —
   * worse, the blend shifts whenever one device happens to miss a day, which
   * is exactly the drift the recovery baseline is trying to detect.
   */
  result(): Array<{ d: string } & HealthDay> {
    const out: Array<{ d: string } & HealthDay> = [];
    for (const [d, sources] of [...this.days.entries()].sort(([x], [y]) => x.localeCompare(y))) {
      const day: { d: string } & HealthDay = { d };
      const all = [...sources.values()];

      // Latest reading wins outright, whichever device produced it.
      const latest = <K extends 'wt' | 'bf'>(k: K) =>
        all.reduce<{ v: number; ts: number } | undefined>(
          (best, s) => (s[k] && (!best || s[k]!.ts >= best.ts) ? s[k] : best),
          undefined,
        );
      const wt = latest('wt');
      const bf = latest('bf');
      if (wt) day.wt = round(wt.v, 2);
      if (bf) day.bf = round(bf.v, 1);

      // Largest single source, never the sum across sources.
      const best = <K extends 'steps' | 'aen' | 'sleep' | 'wo'>(k: K) =>
        all.reduce<number | undefined>(
          (m, s) => (s[k] != null && (m == null || s[k]! > m) ? s[k] : m),
          undefined,
        );
      const steps = best('steps');
      const aen = best('aen');
      const sleep = best('sleep');
      const wo = best('wo');
      if (sleep != null) day.sleep = round(sleep, 2);
      if (steps != null) day.steps = Math.round(steps);
      if (aen != null) day.aen = Math.round(aen);
      if (wo != null) day.wo = wo;

      // Mean within the best-covered source, not across sources.
      const richest = <K extends 'rhr' | 'hrv'>(k: K) =>
        all.reduce<{ sum: number; n: number } | undefined>(
          (m, s) => (s[k]?.n && (!m || s[k]!.n > m.n) ? s[k] : m),
          undefined,
        );
      const rhr = richest('rhr');
      const hrv = richest('hrv');
      if (rhr?.n) day.rhr = round(rhr.sum / rhr.n, 1);
      if (hrv?.n) day.hrv = round(hrv.sum / hrv.n, 1);

      // A day with nothing but an unmatched marker is not worth storing.
      if (Object.keys(day).length > 1) out.push(day);
    }
    return out;
  }

  /** Distinct source names seen, so an import can say which devices it read. */
  sources(): string[] {
    const names = new Set<string>();
    for (const day of this.days.values()) for (const n of day.keys()) names.add(n);
    return [...names].sort();
  }
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

export interface ParseProgress {
  bytesRead: number;
  totalBytes: number;
  records: number;
}

/**
 * Stream a File through the accumulator, reporting progress as it goes.
 * Used directly in tests; the Web Worker wraps this for the UI.
 */
export async function parseHealthExport(
  file: Blob,
  onProgress?: (p: ParseProgress) => void,
): Promise<Array<{ d: string } & HealthDay>> {
  const acc = new HealthExportAccumulator();
  const total = file.size;
  let read = 0;

  // Decode by hand rather than via TextDecoderStream so progress counts real
  // bytes against file.size instead of post-decode characters.
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    read += value.byteLength;
    acc.push(decoder.decode(value, { stream: true }));
    const now = Date.now();
    // Throttle progress so a fast stream doesn't drown the main thread in messages.
    if (onProgress && now - lastReport > 120) {
      lastReport = now;
      onProgress({ bytesRead: read, totalBytes: total, records: acc.records });
    }
  }
  acc.push(decoder.decode());
  acc.end();
  onProgress?.({ bytesRead: total, totalBytes: total, records: acc.records });
  return acc.result();
}
