import { describe, expect, it } from 'vitest';
import {
  CREATINE_WATER_DAYS,
  caffeineBetween,
  creatineConfounds,
  creatineStart,
  dosesOfKind,
  lateStimulantDoses,
  nutritiveByDay,
} from './supplements';
import { freshData, type AppData, type Supplement, type SupplementKind } from './types';

const DAY = 864e5;
const END = '2026-09-01';

function iso(daysBeforeEnd: number): string {
  return new Date(new Date(END).getTime() - daysBeforeEnd * DAY).toISOString().slice(0, 10);
}

function supp(id: string, kind: SupplementKind, extra: Partial<Supplement> = {}): Supplement {
  return {
    id,
    name: id,
    kind,
    servingLabel: '1 serving',
    addedAt: iso(30),
    ...extra,
  };
}

function withDose(d: AppData, supplementId: string, daysBeforeEnd: number, hour = 8, servings = 1) {
  const date = iso(daysBeforeEnd);
  d.doses.push({
    id: `${supplementId}-${date}-${hour}`,
    supplementId,
    date,
    at: `${date}T${String(hour).padStart(2, '0')}:00:00`,
    servings,
  });
  return d;
}

describe('nutritiveByDay', () => {
  it('multiplies per-serving macros by the number of servings', () => {
    const d = freshData();
    d.supplements = [supp('whey', 'nutritive', { kcal: 110, protein_g: 24 })];
    withDose(d, 'whey', 0, 8, 2);

    expect(nutritiveByDay(d).get(iso(0))).toEqual({ kcal: 220, protein: 48 });
  });

  it('sums several nutritive supplements on one day', () => {
    const d = freshData();
    d.supplements = [
      supp('whey', 'nutritive', { kcal: 110, protein_g: 24 }),
      supp('casein', 'nutritive', { kcal: 120, protein_g: 25 }),
    ];
    withDose(d, 'whey', 0);
    withDose(d, 'casein', 0);

    expect(nutritiveByDay(d).get(iso(0))).toEqual({ kcal: 230, protein: 49 });
  });

  it('ignores non-nutritive kinds, which carry no macros', () => {
    const d = freshData();
    d.supplements = [supp('mono', 'creatine'), supp('shred', 'stimulant', { caffeine_mg: 200 })];
    withDose(d, 'mono', 0);
    withDose(d, 'shred', 0);

    expect(nutritiveByDay(d).size).toBe(0);
  });

  it('ignores doses whose product has been deleted', () => {
    const d = freshData();
    withDose(d, 'gone', 0);
    expect(nutritiveByDay(d).size).toBe(0);
  });
});

describe('creatineStart', () => {
  it('returns the earliest creatine dose, not the first one logged', () => {
    const d = freshData();
    d.supplements = [supp('mono', 'creatine')];
    withDose(d, 'mono', 3);
    withDose(d, 'mono', 20);
    withDose(d, 'mono', 10);

    expect(creatineStart(d)).toBe(iso(20));
  });

  it('is null when no creatine has been taken', () => {
    const d = freshData();
    d.supplements = [supp('whey', 'nutritive')];
    withDose(d, 'whey', 1);

    expect(creatineStart(d)).toBeNull();
  });
});

describe('creatineConfounds', () => {
  it('flags a window that overlaps the saturation period', () => {
    const d = freshData();
    d.supplements = [supp('mono', 'creatine')];
    withDose(d, 'mono', 14);

    expect(creatineConfounds(d, iso(27), iso(0))).toBe(true);
  });

  it('clears once the window starts after saturation completes', () => {
    const d = freshData();
    d.supplements = [supp('mono', 'creatine')];
    // Started well before the window: saturation finished before it opens.
    withDose(d, 'mono', CREATINE_WATER_DAYS + 30);

    expect(creatineConfounds(d, iso(27), iso(0))).toBe(false);
  });

  it('clears for a window that ends before creatine was ever started', () => {
    const d = freshData();
    d.supplements = [supp('mono', 'creatine')];
    withDose(d, 'mono', 0);

    expect(creatineConfounds(d, iso(60), iso(40))).toBe(false);
  });

  it('is false when no creatine is logged at all', () => {
    expect(creatineConfounds(freshData(), iso(27), iso(0))).toBe(false);
  });
});

describe('lateStimulantDoses', () => {
  it('counts only doses at or after 16:00', () => {
    const d = freshData();
    d.supplements = [supp('shred', 'stimulant', { caffeine_mg: 200 })];
    withDose(d, 'shred', 1, 7);
    withDose(d, 'shred', 2, 18);
    withDose(d, 'shred', 3, 16);

    expect(lateStimulantDoses(d, iso(6), iso(0))).toHaveLength(2);
  });

  it('does not treat a nutritive dose as a stimulant however late it is', () => {
    const d = freshData();
    d.supplements = [supp('whey', 'nutritive', { kcal: 110, protein_g: 24 })];
    withDose(d, 'whey', 1, 22);

    expect(lateStimulantDoses(d, iso(6), iso(0))).toHaveLength(0);
  });
});

describe('dosesOfKind and caffeineBetween', () => {
  it('filters by kind within the range', () => {
    const d = freshData();
    d.supplements = [supp('shred', 'stimulant', { caffeine_mg: 200 }), supp('mono', 'creatine')];
    withDose(d, 'shred', 1);
    withDose(d, 'mono', 1);
    withDose(d, 'shred', 30);

    expect(dosesOfKind(d, 'stimulant', iso(6), iso(0))).toHaveLength(1);
  });

  it('totals caffeine across servings', () => {
    const d = freshData();
    d.supplements = [supp('shred', 'stimulant', { caffeine_mg: 200 })];
    withDose(d, 'shred', 1, 8, 2);
    withDose(d, 'shred', 2, 8, 1);

    expect(caffeineBetween(d, iso(6), iso(0))).toBe(600);
  });
});
