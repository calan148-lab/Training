import { describe, expect, it } from 'vitest';
import type { Meal, MealItem } from '../domain/types';
import { repeatCandidates, scaleItem, settingsReady, totalsOf } from './vision';

const item = (over: Partial<MealItem> = {}): MealItem => ({
  name: 'rice',
  portionEstimate: 'one bowl',
  grams: 200,
  kcal: 260,
  protein_g: 5.4,
  carbs_g: 57,
  fat_g: 0.6,
  confidence: 0.7,
  ...over,
});

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  date: '2026-08-31',
  at: '2026-08-31T12:00:00.000Z',
  status: 'confirmed',
  items: [item()],
  totals: totalsOf([item()]),
  assumptions: [],
  ...over,
});

describe('totalsOf', () => {
  it('sums every macro across items', () => {
    const t = totalsOf([item(), item({ name: 'chicken', kcal: 300, protein_g: 40, carbs_g: 0, fat_g: 15 })]);
    expect(t).toEqual({ kcal: 560, protein_g: 45.4, carbs_g: 57, fat_g: 15.6 });
  });

  it('is zero for an empty meal', () => {
    expect(totalsOf([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});

describe('scaleItem', () => {
  it('scales mass, calories and macros together', () => {
    const half = scaleItem(item(), 0.5);
    expect(half.grams).toBe(100);
    expect(half.kcal).toBe(130);
    expect(half.protein_g).toBeCloseTo(2.7, 1);
  });

  it('leaves the name and portion wording alone', () => {
    expect(scaleItem(item(), 2).name).toBe('rice');
    expect(scaleItem(item(), 2).portionEstimate).toBe('one bowl');
  });
});

describe('settingsReady', () => {
  it('needs both a URL and a token', () => {
    expect(settingsReady({})).toBe(false);
    expect(settingsReady({ workerUrl: 'https://x.dev' })).toBe(false);
    expect(settingsReady({ workerUrl: 'https://x.dev', workerToken: 't' })).toBe(true);
  });
});

describe('repeatCandidates', () => {
  it('returns most recent first', () => {
    const meals = [
      meal({ id: 'a', items: [item({ name: 'rice' })] }),
      meal({ id: 'b', items: [item({ name: 'oats' })] }),
    ];
    expect(repeatCandidates(meals).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('collapses repeats of the same meal', () => {
    const meals = [
      meal({ id: 'a', items: [item({ name: 'rice' })] }),
      meal({ id: 'b', items: [item({ name: 'rice' })] }),
    ];
    expect(repeatCandidates(meals)).toHaveLength(1);
  });

  it('treats the same items in a different order as the same meal', () => {
    const meals = [
      meal({ id: 'a', items: [item({ name: 'rice' }), item({ name: 'chicken' })] }),
      meal({ id: 'b', items: [item({ name: 'chicken' }), item({ name: 'rice' })] }),
    ];
    expect(repeatCandidates(meals)).toHaveLength(1);
  });

  it('ignores meals that were never confirmed', () => {
    const meals = [meal({ id: 'a', status: 'pending' }), meal({ id: 'b', status: 'failed' })];
    expect(repeatCandidates(meals)).toEqual([]);
  });

  it('respects the limit', () => {
    const meals = Array.from({ length: 20 }, (_, i) => meal({ id: `m${i}`, items: [item({ name: `food${i}` })] }));
    expect(repeatCandidates(meals, 3)).toHaveLength(3);
  });
});
