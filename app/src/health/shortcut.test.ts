import { describe, expect, it } from 'vitest';
import { freshData } from '../domain/types';
import { HealthImportError, mergeHealthDays, parseShortcutPayload } from './shortcut';

const ok = JSON.stringify({
  t: 'health8w',
  v: 1,
  days: [{ d: '2026-08-31', wt: 71.4, bf: 14.2, rhr: 52, hrv: 68, sleep: 7.2, steps: 8412, aen: 540, wo: 1 }],
});

describe('parseShortcutPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(parseShortcutPayload(ok).days[0]).toMatchObject({ d: '2026-08-31', wt: 71.4, steps: 8412 });
  });

  it('rejects a stale Shortcut loudly instead of importing nothing', () => {
    const stale = JSON.stringify({ t: 'health8w', v: 0, days: [] });
    expect(() => parseShortcutPayload(stale)).toThrow(/v0.*expects v1|Update the Shortcut/);
  });

  it('rejects a payload that is not ours', () => {
    expect(() => parseShortcutPayload('{"t":"something","v":1,"days":[]}')).toThrow(HealthImportError);
  });

  it('rejects malformed JSON with a readable message', () => {
    expect(() => parseShortcutPayload('{oops')).toThrow(/valid JSON/);
  });

  it('drops out-of-range values rather than poisoning the trend', () => {
    // A Shortcut wired to grams would send 71400; a missing sample can send 0.
    const bad = JSON.stringify({ t: 'health8w', v: 1, days: [{ d: '2026-08-31', wt: 71400, rhr: 0, steps: 8412 }] });
    const day = parseShortcutPayload(bad).days[0]!;
    expect(day.wt).toBeUndefined();
    expect(day.rhr).toBeUndefined();
    expect(day.steps).toBe(8412);
  });

  it('skips entries with an unusable date', () => {
    const mixed = JSON.stringify({
      t: 'health8w', v: 1,
      days: [{ d: '31/08/2026', steps: 1 }, { d: '2026-08-31', steps: 2 }],
    });
    expect(parseShortcutPayload(mixed).days).toHaveLength(1);
  });

  it('throws when nothing usable survives validation', () => {
    expect(() => parseShortcutPayload('{"t":"health8w","v":1,"days":[{"d":"bad"}]}')).toThrow(/No usable days/);
  });
});

describe('mergeHealthDays', () => {
  it('adds new days and stamps the sync time', () => {
    const now = new Date('2026-09-01T10:00:00Z');
    const d = mergeHealthDays(freshData(), [{ d: '2026-08-31', wt: 71.4 }], 'shortcut', now);
    expect(d.health.days['2026-08-31']).toEqual({ wt: 71.4 });
    expect(d.health.lastSync).toBe(now.toISOString());
    expect(d.health.src).toBe('shortcut');
  });

  it('never clears a stored field the incoming day is silent about', () => {
    // The Shortcut only reports body fat on days you used the scale; those
    // silences must not wipe the readings that already exist.
    let d = freshData();
    d = mergeHealthDays(d, [{ d: '2026-08-31', wt: 71.4, bf: 14.2 }], 'shortcut');
    d = mergeHealthDays(d, [{ d: '2026-08-31', wt: 71.6 }], 'shortcut');
    expect(d.health.days['2026-08-31']).toEqual({ wt: 71.6, bf: 14.2 });
  });

  it('lets a later import correct an earlier value', () => {
    let d = freshData();
    d = mergeHealthDays(d, [{ d: '2026-08-31', steps: 100 }], 'shortcut');
    d = mergeHealthDays(d, [{ d: '2026-08-31', steps: 8412 }], 'export');
    expect(d.health.days['2026-08-31']!.steps).toBe(8412);
    expect(d.health.src).toBe('export');
  });

  it('leaves other days untouched', () => {
    let d = freshData();
    d = mergeHealthDays(d, [{ d: '2026-08-30', steps: 1 }, { d: '2026-08-31', steps: 2 }], 'shortcut');
    d = mergeHealthDays(d, [{ d: '2026-08-31', steps: 3 }], 'shortcut');
    expect(d.health.days['2026-08-30']!.steps).toBe(1);
  });
});
