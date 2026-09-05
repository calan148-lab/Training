import { describe, expect, it } from 'vitest';
import { SESSIONS, SNAME } from './plan';
import { calcXP, isFullSession, maxWeekCount, planFor, weekBuckets } from './progress';
import { freshData, type AppData } from './types';

/** 2026-07-06 is a Monday, so the block starts on a week boundary. */
const START = '2026-07-06';
const WED_W1 = '2026-07-08';
const WED_W2 = '2026-07-15';

function base(): AppData {
  return { ...freshData(), start: START };
}

describe('the core day', () => {
  it('is scheduled on Wednesday in both weeks of the rotation', () => {
    const d = base();
    expect(planFor(d, WED_W1)).toBe('D');
    expect(planFor(d, WED_W2)).toBe('D');
  });

  it('leaves Sunday as the only empty day', () => {
    const d = base();
    const start = new Date(START).getTime();
    const empty: string[] = [];
    for (let i = 0; i < 14; i++) {
      const iso = new Date(start + i * 864e5).toISOString().slice(0, 10);
      if (planFor(d, iso) === '') empty.push(iso);
    }
    // Sunday of each of the two rotation weeks, and nothing else.
    expect(empty).toEqual(['2026-07-12', '2026-07-19']);
  });

  it('has exercises and a name, like every other logged session type', () => {
    expect(SNAME.D).toBe('Core');
    expect(SESSIONS.D.ex.length).toBeGreaterThan(0);
  });

  it('trains hanging and floor core as separate exercises', () => {
    const keys = SESSIONS.D.ex.map((e) => e.k);
    expect(keys).toContain('core');
    expect(keys).toContain('floor');
  });
});

describe('what a core day counts for', () => {
  it('is not a full session', () => {
    expect(isFullSession({ date: START, type: 'D' })).toBe(false);
    expect(isFullSession({ date: START, type: 'C' })).toBe(true);
    expect(isFullSession({ date: START, type: 'A' })).toBe(true);
  });

  it('pays less XP than a full session', () => {
    const core = { ...base(), sessions: [{ date: START, type: 'D' as const }] };
    const full = { ...base(), sessions: [{ date: START, type: 'A' as const }] };
    expect(calcXP(core)).toBeLessThan(calcXP(full));
  });

  it('cannot make a three-session week earn the four-session bonus', () => {
    const three: AppData = {
      ...base(),
      sessions: [
        { date: '2026-07-06', type: 'A' },
        { date: '2026-07-07', type: 'C' },
        { date: '2026-07-08', type: 'D' },
        { date: '2026-07-09', type: 'B' },
      ],
    };
    expect(maxWeekCount(three)).toBe(3);

    const four: AppData = {
      ...three,
      sessions: [...three.sessions, { date: '2026-07-10', type: 'C' }],
    };
    expect(maxWeekCount(four)).toBe(4);
    expect(calcXP(four) - calcXP(three)).toBeGreaterThan(200);
  });

  it('still shows up in the plain weekly counter', () => {
    const d: AppData = {
      ...base(),
      sessions: [
        { date: '2026-07-06', type: 'A' },
        { date: '2026-07-08', type: 'D' },
      ],
    };
    // The counter on Today reports everything logged; only the judgements filter.
    expect(weekBuckets(d)[0]).toBe(2);
    expect(maxWeekCount(d)).toBe(1);
  });
});
