import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_BACKUP_KEY, LEGACY_KEY, db, loadData, migrate, saveData, trimHealth } from './db';
import { HEALTH_DAY_CAP, SCHEMA_VERSION, freshData } from './domain/types';

/**
 * A realistic v1 payload: exactly the shape the original single-file app wrote
 * to localStorage, including its quirks (no `v`, no `health`, `seen` present).
 */
const V1_PAYLOAD = {
  start: '2026-07-06',
  ladders: { pullup: 3, pushup: 2, pike: 1, squat: 4, core: 1, floor: 0 },
  sessions: [
    { date: '2026-07-06', type: 'A', sets: [8, 7, 6, 6, 10, 9, 8, 8, 12, 11, 10, 10, 18, 18, 16, 15, 12, 12, 10, 10, 10, 9], best: { pullup: 8 } },
    { date: '2026-07-07', type: 'C', rounds: 12 },
    { date: '2026-07-09', type: 'B', sets: [9, 8, 8, 7, 7], best: { pullup: 9 } },
  ],
  weights: [
    { date: '2026-07-06', kg: 71.2 },
    { date: '2026-07-13', kg: 71.6 },
  ],
  seen: ['first', 'pull'],
};

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  await db.state.clear();
  await db.photos.clear();
});

describe('migrate', () => {
  it('carries every field of a v1 payload across intact', () => {
    const d = migrate(V1_PAYLOAD);
    expect(d.v).toBe(SCHEMA_VERSION);
    expect(d.start).toBe('2026-07-06');
    expect(d.ladders).toEqual(V1_PAYLOAD.ladders);
    expect(d.sessions).toEqual(V1_PAYLOAD.sessions);
    expect(d.weights).toEqual(V1_PAYLOAD.weights);
    expect(d.seen).toEqual(['first', 'pull']);
  });

  it('fills in the fields v1 never had', () => {
    const d = migrate(V1_PAYLOAD);
    expect(d.health).toEqual({ lastSync: null, src: null, days: {} });
    expect(d.meals).toEqual([]);
    expect(d.settings).toEqual({});
    expect(d.profile.goal).toBe('gain');
  });

  it('backfills a ladder key added after the save was written', () => {
    const { floor: _floor, ...withoutFloor } = V1_PAYLOAD.ladders;
    const d = migrate({ ...V1_PAYLOAD, ladders: withoutFloor });
    expect(d.ladders.floor).toBe(0);
    expect(d.ladders.pullup).toBe(3);
  });

  it('survives junk rather than throwing', () => {
    expect(migrate(null).sessions).toEqual([]);
    expect(migrate('nonsense').sessions).toEqual([]);
    expect(migrate({ sessions: 'not an array' }).sessions).toEqual([]);
  });

  it('is idempotent', () => {
    const once = migrate(V1_PAYLOAD);
    expect(migrate(once)).toEqual(once);
  });
});

describe('trimHealth', () => {
  it('keeps only the most recent days, oldest dropped first', () => {
    const d = freshData();
    for (let i = 0; i < HEALTH_DAY_CAP + 50; i++) {
      const date = new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10);
      d.health.days[date] = { steps: i };
    }
    const kept = Object.keys(trimHealth(d).health.days).sort();
    expect(kept).toHaveLength(HEALTH_DAY_CAP);
    // 450 days from 2024-01-01 (a leap year) ends at 2025-03-25; the 50
    // oldest are dropped, so the window starts 50 days in.
    expect(kept[kept.length - 1]).toBe('2025-03-25');
    expect(kept[0]).toBe('2024-02-20');
  });

  it('leaves a small store alone', () => {
    const d = freshData();
    d.health.days['2026-08-31'] = { steps: 1 };
    expect(Object.keys(trimHealth(d).health.days)).toEqual(['2026-08-31']);
  });
});

describe('first-run migration from localStorage', () => {
  it('moves a real training block into IndexedDB without losing anything', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(V1_PAYLOAD));

    const d = await loadData();
    expect(d.sessions).toHaveLength(3);
    expect(d.sessions[0]!.best).toEqual({ pullup: 8 });
    expect(d.ladders.squat).toBe(4);
    expect(d.weights).toHaveLength(2);
    expect(d.seen).toEqual(['first', 'pull']);

    // It really landed in IndexedDB, not just in the returned object.
    const stored = await db.state.get('app');
    expect(stored!.data.sessions).toHaveLength(3);
  });

  it('keeps the original payload and a separate backup copy', async () => {
    const raw = JSON.stringify(V1_PAYLOAD);
    localStorage.setItem(LEGACY_KEY, raw);
    await loadData();

    // The source of truth is never deleted, so a bad migration stays recoverable.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
    expect(localStorage.getItem(LEGACY_BACKUP_KEY)).toBe(raw);
  });

  it('does not re-run once IndexedDB holds state', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(V1_PAYLOAD));
    const first = await loadData();

    first.sessions.push({ date: '2026-07-11', type: 'C', rounds: 15 });
    await saveData(first);

    // A second boot must read what is stored, not re-import the stale legacy blob.
    const second = await loadData();
    expect(second.sessions).toHaveLength(4);
  });

  it('does not overwrite an existing backup on a later boot', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(V1_PAYLOAD));
    localStorage.setItem(LEGACY_BACKUP_KEY, '{"the":"original"}');
    await loadData();
    expect(localStorage.getItem(LEGACY_BACKUP_KEY)).toBe('{"the":"original"}');
  });

  it('starts fresh when there is nothing to migrate', async () => {
    const d = await loadData();
    expect(d.sessions).toEqual([]);
    expect(d.v).toBe(SCHEMA_VERSION);
  });

  it('starts fresh rather than throwing on an unparseable legacy value', async () => {
    localStorage.setItem(LEGACY_KEY, '{ this is not json');
    const d = await loadData();
    expect(d.sessions).toEqual([]);
  });
});

describe('saveData', () => {
  it('trims health on the way in so storage stays bounded', async () => {
    const d = freshData();
    for (let i = 0; i < HEALTH_DAY_CAP + 10; i++) {
      const date = new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10);
      d.health.days[date] = { steps: i };
    }
    await saveData(d);
    const stored = await db.state.get('app');
    expect(Object.keys(stored!.data.health.days)).toHaveLength(HEALTH_DAY_CAP);
  });

  it('keeps a year of health data well inside the storage budget', async () => {
    const d = freshData();
    for (let i = 0; i < 365; i++) {
      const date = new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10);
      d.health.days[date] = { wt: 71.4, bf: 14.2, rhr: 52, hrv: 68, sleep: 7.2, steps: 8412, aen: 540, wo: 1 };
    }
    const bytes = JSON.stringify(d).length;
    expect(bytes).toBeLessThan(120_000);
  });
});
