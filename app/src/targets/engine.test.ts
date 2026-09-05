import { describe, expect, it } from 'vitest';
import {
  freshData,
  type AppData,
  type Meal,
  type Supplement,
  type SupplementKind,
} from '../domain/types';
import {
  KCAL_PER_KG,
  intakeByDay,
  surplusFor,
  energyTolerance,
  estimateMaintenance,
  evaluateTargets,
  energyTarget,
  frequencyTarget,
  leanQualityTarget,
  proteinTarget,
  recoveryTarget,
  sleepTarget,
  slopePerDay,
  weightTrendTarget,
} from './engine';

const DAY = 864e5;
const END = '2026-09-01';

function iso(daysBeforeEnd: number): string {
  return new Date(new Date(END).getTime() - daysBeforeEnd * DAY).toISOString().slice(0, 10);
}

function base(): AppData {
  const d = freshData();
  d.start = iso(27);
  return d;
}

/** Weight rising by exactly `kgPerMonth`, one reading a day for `days` days. */
function withWeightTrend(d: AppData, kgPerMonth: number, days = 28, from = 70): AppData {
  const perDay = kgPerMonth / 30.44;
  for (let i = days - 1; i >= 0; i--) {
    d.health.days[iso(i)] = { ...d.health.days[iso(i)], wt: from + (days - 1 - i) * perDay };
  }
  return d;
}

function meal(date: string, kcal: number, protein: number): Meal {
  return {
    id: `${date}-${kcal}-${protein}`,
    date,
    at: `${date}T12:00:00.000Z`,
    status: 'confirmed',
    items: [],
    totals: { kcal, protein_g: protein, carbs_g: 0, fat_g: 0 },
    assumptions: [],
  };
}

function withIntake(d: AppData, kcal: number, protein: number, days = 28): AppData {
  for (let i = days - 1; i >= 0; i--) d.meals.push(meal(iso(i), kcal, protein));
  return d;
}

describe('slopePerDay', () => {
  it('recovers a known slope', () => {
    const pts = [
      { date: iso(20), v: 10 },
      { date: iso(10), v: 20 },
      { date: iso(0), v: 30 },
    ];
    expect(slopePerDay(pts)).toBeCloseTo(1, 6);
  });

  it('returns null for a single point', () => {
    expect(slopePerDay([{ date: END, v: 1 }])).toBeNull();
  });

  it('returns null when every reading is on the same day', () => {
    expect(slopePerDay([{ date: END, v: 1 }, { date: END, v: 2 }])).toBeNull();
  });
});

describe('weight trend target', () => {
  it('is in band at +0.35 kg/month', () => {
    const r = weightTrendTarget(withWeightTrend(base(), 0.35), END);
    expect(r.status).toBe('in');
    expect(r.value).toBeCloseTo(0.35, 1);
  });

  it('is low when flat, and says to eat more', () => {
    const r = weightTrendTarget(withWeightTrend(base(), 0), END);
    expect(r.status).toBe('low');
    expect(r.note).toMatch(/eat more/i);
  });

  it('is high when gaining too fast', () => {
    expect(weightTrendTarget(withWeightTrend(base(), 2), END).status).toBe('high');
  });

  it('reports nodata rather than guessing from two readings', () => {
    const d = base();
    d.weights = [
      { date: iso(20), kg: 70 },
      { date: iso(0), kg: 71 },
    ];
    expect(weightTrendTarget(d, END).status).toBe('nodata');
  });

  it('is not fooled by a flat middle between two distant readings', () => {
    // First and last differ by +1 kg, but everything in between is flat:
    // the old first-vs-last comparison called this "on target".
    const d = base();
    d.weights = [{ date: iso(27), kg: 70 }];
    for (let i = 26; i >= 1; i--) d.weights.push({ date: iso(i), kg: 71 });
    d.weights.push({ date: iso(0), kg: 71 });
    const r = weightTrendTarget(d, END);
    expect(r.value!).toBeLessThan(0.25);
    expect(r.status).toBe('low');
  });

  it('follows the goal — a flat trend is on target for recomp', () => {
    const d = withWeightTrend(base(), 0);
    d.profile.goal = 'recomp';
    expect(weightTrendTarget(d, END).status).toBe('in');
  });
});

describe('surplus is derived from the weight band', () => {
  it('matches the band midpoint rather than a folk figure', () => {
    // +0.375 kg/mo midpoint x 7700 kcal/kg / 30.44 days ~= 95 kcal/day,
    // not the "+250 to bulk" rule of thumb, which is nearly 1 kg/mo.
    expect(surplusFor(base())).toBeCloseTo(95, -1);
  });

  it('goes negative for a cut', () => {
    const d = base();
    d.profile.goal = 'cut';
    expect(surplusFor(d)).toBeLessThan(-300);
  });

  it('keeps the tolerance narrower than the surplus it judges', () => {
    // Otherwise eating at maintenance on a lean gain could never be flagged.
    const s = surplusFor(base());
    expect(energyTolerance(s)).toBeLessThan(Math.abs(s) + 1);
  });

  it('is zero for recomp', () => {
    const d = base();
    d.profile.goal = 'recomp';
    expect(surplusFor(d)).toBe(0);
  });

  it('keeps the weight and energy targets pointing the same way', () => {
    // Eating exactly the implied surplus must never read as "over target".
    const d = withWeightTrend(base(), 0.375, 28, 80);
    withIntake(d, 3000 + surplusFor(d), 160);
    expect(energyTarget(d, END).status).not.toBe('high');
  });
});

describe('empirical maintenance', () => {
  it('derives maintenance from intake minus what the weight trend banked', () => {
    const gainPerMonth = 0.5;
    const d = withIntake(withWeightTrend(base(), gainPerMonth), 3000, 150);
    const m = estimateMaintenance(d, END)!;
    expect(m.basis).toBe('empirical');
    const expected = 3000 - (gainPerMonth / 30.44) * KCAL_PER_KG;
    expect(m.kcal).toBeCloseTo(expected, 0);
  });

  it('cancels a systematic photo bias out of the advice', () => {
    // Every meal reads 15% low. Maintenance comes out 15% low too, so the gap
    // that drives the advice is unchanged in direction and near-unchanged in size.
    const truthful = withIntake(withWeightTrend(base(), 0.35), 3000, 150);
    const biased = withIntake(withWeightTrend(base(), 0.35), 3000 * 0.85, 150);
    const a = energyTarget(truthful, END);
    const b = energyTarget(biased, END);
    expect(a.status).toBe(b.status);
    // Both are told to add food, and by a similar amount.
    expect(a.note).toMatch(/short|holding/);
    expect(b.note).toMatch(/short|holding/);
  });

  it('falls back to the formula when there is no intake history', () => {
    const d = withWeightTrend(base(), 0.35);
    d.profile = { goal: 'gain', heightCm: 178, age: 30, sex: 'male' };
    const m = estimateMaintenance(d, END)!;
    expect(m.basis).toBe('formula');
    expect(m.kcal).toBeGreaterThan(1500);
  });

  it('returns null rather than inventing a number', () => {
    expect(estimateMaintenance(base(), END)).toBeNull();
  });
});

describe('energy target', () => {
  it('refuses to judge on sparse logging', () => {
    const d = withWeightTrend(base(), 0.35);
    d.profile = { goal: 'gain', heightCm: 178, age: 30, sex: 'male' };
    d.meals = [meal(iso(1), 3000, 150), meal(iso(2), 3000, 150)];
    const r = energyTarget(d, END);
    expect(r.status).toBe('nodata');
    expect(r.note).toMatch(/2 of the last 14/);
  });

  it('reports as context, not pass/fail, when maintenance came from your own data', () => {
    // Empirical maintenance is intake minus what the weight trend banked, so
    // this target restates the weight trend and must not be scored again.
    const d = withIntake(withWeightTrend(base(), 0), 2000, 150);
    const r = energyTarget(d, END);
    expect(r.status).toBe('info');
    expect(r.note).toMatch(/short — add about/);
  });

  it('names an amount to add when eating at maintenance on a gain', () => {
    const d = withIntake(withWeightTrend(base(), 0), 2000, 150);
    // Flat weight means maintenance == intake, so the shortfall is the surplus.
    expect(energyTarget(d, END).note).toContain(`${surplusFor(d)} kcal/day short`);
  });

  it('does pass/fail while maintenance is still a formula estimate', () => {
    const d = base();
    d.profile = { goal: 'gain', heightCm: 178, age: 30, sex: 'male' };
    // Weigh-ins too sparse for an empirical figure, but meals well logged.
    d.weights = [{ date: iso(0), kg: 80 }];
    withIntake(d, 1200, 150, 14);
    const r = energyTarget(d, END);
    expect(r.status).toBe('low');
    expect(r.note).toMatch(/under target/);
  });
});

describe('protein target', () => {
  it('scales the band with bodyweight', () => {
    const d = withIntake(withWeightTrend(base(), 0.35, 28, 80), 3000, 100);
    const r = proteinTarget(d, END);
    // 100 g against an 80 kg bodyweight is well under 1.6 g/kg.
    expect(r.status).toBe('low');
    expect(r.band).toContain('128');
  });

  it('is in band at 2 g/kg', () => {
    const d = withIntake(withWeightTrend(base(), 0.35, 28, 80), 3000, 160);
    expect(proteinTarget(d, END).status).toBe('in');
  });
});

describe('recovery target', () => {
  it('flags a rising resting heart rate against your own baseline', () => {
    const d = base();
    for (let i = 34; i >= 7; i--) d.health.days[iso(i)] = { rhr: 50 };
    for (let i = 6; i >= 0; i--) d.health.days[iso(i)] = { rhr: 56 };
    const r = recoveryTarget(d, END);
    expect(r.status).toBe('high');
    expect(r.note).toMatch(/resting HR up/);
  });

  it('passes when steady', () => {
    const d = base();
    for (let i = 34; i >= 0; i--) d.health.days[iso(i)] = { rhr: 50, hrv: 65 };
    expect(recoveryTarget(d, END).status).toBe('in');
  });
});

describe('sleep target', () => {
  it('is low under 7 hours', () => {
    const d = base();
    for (let i = 6; i >= 0; i--) d.health.days[iso(i)] = { sleep: 6.1 };
    expect(sleepTarget(d, END).status).toBe('low');
  });
});

describe('frequency target', () => {
  it('counts sessions in the trailing week', () => {
    const d = base();
    for (let i = 0; i < 4; i++) d.sessions.push({ date: iso(i), type: 'A' });
    expect(frequencyTarget(d, END).status).toBe('in');
  });

  it('does not let core days stand in for the four', () => {
    const d = base();
    for (let i = 0; i < 3; i++) d.sessions.push({ date: iso(i), type: 'A' });
    d.sessions.push({ date: iso(3), type: 'D' });
    const r = frequencyTarget(d, END);
    expect(r.status).toBe('low');
    expect(r.value).toBe(3);
    expect(r.note).toMatch(/1 core day, which don't count/);
  });

  it('counts core days toward what Health should have seen', () => {
    const d = base();
    for (let i = 0; i < 4; i++) d.sessions.push({ date: iso(i), type: 'A' });
    d.sessions.push({ date: iso(4), type: 'D' });
    d.health.days[iso(0)] = { wo: 3 };
    d.health.days[iso(1)] = { wo: 2 };
    // Five logged against five seen — nothing is missing.
    expect(frequencyTarget(d, END).note).not.toMatch(/left unlogged/);
  });

  it('notices workouts Health saw that you never logged', () => {
    const d = base();
    d.sessions.push({ date: iso(1), type: 'A' });
    d.health.days[iso(1)] = { wo: 1 };
    d.health.days[iso(2)] = { wo: 1 };
    d.health.days[iso(3)] = { wo: 1 };
    expect(frequencyTarget(d, END).note).toMatch(/left unlogged/);
  });
});

describe('lean-gain quality', () => {
  it('passes when most of the gain is lean', () => {
    const d = base();
    // +2 kg total, +0.4 kg of it fat.
    d.health.days[iso(27)] = { wt: 70, bf: 15 };
    d.health.days[iso(0)] = { wt: 72, bf: 15.0 };
    const r = leanQualityTarget(d, END);
    expect(r.status).toBe('in');
  });

  it('flags a gain that is mostly fat', () => {
    const d = base();
    d.health.days[iso(27)] = { wt: 70, bf: 15 };
    d.health.days[iso(0)] = { wt: 72, bf: 18 };
    expect(leanQualityTarget(d, END).status).toBe('high');
  });

  it('does not apply while weight is falling', () => {
    const d = base();
    d.health.days[iso(27)] = { wt: 72, bf: 18 };
    d.health.days[iso(0)] = { wt: 70, bf: 16 };
    expect(leanQualityTarget(d, END).status).toBe('info');
  });
});

describe('verdict', () => {
  it('counts only judgeable targets and surfaces the highest-priority problem', () => {
    const d = withIntake(withWeightTrend(base(), 0), 2000, 150);
    const v = evaluateTargets(d, END);
    expect(v.judgeable).toBeGreaterThan(0);
    expect(v.judgeable).toBeLessThanOrEqual(v.results.length);
    // Weight trend outranks energy balance, so a flat trend is the headline.
    expect(v.headline).toMatch(/eat more/i);
  });

  it('has no headline when nothing is out of band', () => {
    // Intake is chosen to sit on the surplus the weight band itself implies,
    // so the two targets agree rather than pulling against each other.
    const d = withWeightTrend(base(), 0.35, 28, 80);
    const maintenance = 2800 - (0.35 / 30.44) * KCAL_PER_KG;
    withIntake(d, Math.round(maintenance + surplusFor(d)), 160);
    for (let i = 0; i < 4; i++) d.sessions.push({ date: iso(i), type: 'A' });
    for (let i = 34; i >= 0; i--) {
      d.health.days[iso(i)] = { ...d.health.days[iso(i)], rhr: 50, hrv: 65, sleep: 8 };
    }
    const v = evaluateTargets(d, END);
    const failing = v.results.filter((r) => r.status === 'low' || r.status === 'high');
    expect(failing.map((f) => f.id)).toEqual([]);
    expect(v.headline).toBeNull();
    // Energy balance is advice here, so it is reported but not scored.
    expect(v.results.find((r) => r.id === 'energy')!.status).toBe('info');
  });

  it('never counts a nodata target as a pass', () => {
    const v = evaluateTargets(base(), END);
    expect(v.inCount).toBe(0);
    expect(v.results.every((r) => r.status === 'nodata' || r.status === 'info' || r.status === 'low')).toBe(true);
  });
});


/* ------------------------------------------------------------------ */
/* Supplements                                                         */
/* ------------------------------------------------------------------ */

function suppl(id: string, kind: SupplementKind, extra: Partial<Supplement> = {}): Supplement {
  return { id, name: id, kind, servingLabel: '1 serving', addedAt: iso(40), ...extra };
}

function withDoses(d: AppData, supplementId: string, days: number, hour = 8, servings = 1): AppData {
  for (let i = days - 1; i >= 0; i--) {
    const date = iso(i);
    d.doses.push({
      id: `${supplementId}-${date}`,
      supplementId,
      date,
      at: `${date}T${String(hour).padStart(2, '0')}:00:00`,
      servings,
    });
  }
  return d;
}

describe('nutritive supplements reach the intake targets', () => {
  it('counts shake protein toward the protein target', () => {
    const d = base();
    d.weights = [{ date: iso(0), kg: 80 }];
    withIntake(d, 2000, 100, 7);
    const without = proteinTarget(d, END).value!;

    d.supplements = [suppl('whey', 'nutritive', { kcal: 110, protein_g: 24 })];
    withDoses(d, 'whey', 7, 8, 2);

    expect(proteinTarget(d, END).value).toBe(without + 48);
  });

  it('counts shake calories toward measured maintenance', () => {
    const d = withWeightTrend(base(), 0.35);
    withIntake(d, 2400, 150, 28);
    const without = estimateMaintenance(d, END)!.kcal;

    d.supplements = [suppl('whey', 'nutritive', { kcal: 110, protein_g: 24 })];
    withDoses(d, 'whey', 28, 8, 2);

    // 220 kcal a day of shake is 220 kcal a day of maintenance that was
    // previously invisible.
    expect(estimateMaintenance(d, END)!.kcal).toBe(without + 220);
  });

  it('does not let a shake alone make a day count as logged', () => {
    const d = base();
    d.weights = [{ date: iso(0), kg: 80 }];
    d.supplements = [suppl('whey', 'nutritive', { kcal: 110, protein_g: 24 })];
    withDoses(d, 'whey', 7);

    // Seven shake-only days would otherwise read as a full week of 24 g days
    // and report the protein target as catastrophically low.
    expect(proteinTarget(d, END).status).toBe('nodata');
    expect(intakeByDay(d).get(iso(0))!.hasMeal).toBe(false);
  });
});

describe('creatine is not read as fat', () => {
  it('refuses to derive maintenance across saturation', () => {
    const d = withWeightTrend(base(), 0.35);
    withIntake(d, 2400, 150, 28);
    expect(estimateMaintenance(d, END)!.basis).toBe('empirical');

    d.supplements = [suppl('mono', 'creatine')];
    withDoses(d, 'mono', 14);

    // No height/age/sex, so there is no formula fallback either — better to
    // say nothing than to hand back a figure hundreds of kcal wrong.
    expect(estimateMaintenance(d, END)).toBeNull();
  });

  it('falls back to the formula estimate when it can', () => {
    const d = withWeightTrend(base(), 0.35);
    withIntake(d, 2400, 150, 28);
    d.profile = { ...d.profile, heightCm: 180, age: 33, sex: 'male' };
    d.supplements = [suppl('mono', 'creatine')];
    withDoses(d, 'mono', 14);

    expect(estimateMaintenance(d, END)!.basis).toBe('formula');
  });

  it('downgrades the weight trend to context and says why', () => {
    const d = withWeightTrend(base(), 0);
    d.profile = { ...d.profile, goal: 'cut' };
    d.supplements = [suppl('mono', 'creatine')];
    withDoses(d, 'mono', 14);

    const r = weightTrendTarget(d, END);
    expect(r.status).toBe('info');
    expect(r.note).toMatch(/creatine/i);
  });

  it('judges the trend normally once saturation is long past', () => {
    const d = withWeightTrend(base(), 0);
    d.supplements = [suppl('mono', 'creatine')];
    d.doses = [
      { id: 'old', supplementId: 'mono', date: iso(120), at: `${iso(120)}T08:00:00`, servings: 1 },
    ];

    expect(weightTrendTarget(d, END).status).toBe('low');
  });
});

describe('stimulants are named rather than blamed on training', () => {
  it('notes stimulant doses when recovery looks suppressed', () => {
    const d = base();
    for (let i = 27; i >= 0; i--) {
      // Resting heart rate jumps in the trailing week.
      d.health.days[iso(i)] = { rhr: i < 7 ? 62 : 52 };
    }
    d.supplements = [suppl('shred', 'stimulant', { caffeine_mg: 200 })];
    withDoses(d, 'shred', 5);

    const r = recoveryTarget(d, END);
    expect(r.status).toBe('high');
    expect(r.note).toMatch(/stimulant dose/i);
  });

  it('points at the late dose when sleep is short', () => {
    const d = base();
    for (let i = 6; i >= 0; i--) d.health.days[iso(i)] = { sleep: 5.5 };
    d.supplements = [suppl('shred', 'stimulant', { caffeine_mg: 200 })];
    withDoses(d, 'shred', 4, 18);

    const r = sleepTarget(d, END);
    expect(r.status).toBe('low');
    expect(r.note).toMatch(/after 16:00/);
  });

  it('says nothing about caffeine when sleep is fine', () => {
    const d = base();
    for (let i = 6; i >= 0; i--) d.health.days[iso(i)] = { sleep: 8 };
    d.supplements = [suppl('shred', 'stimulant', { caffeine_mg: 200 })];
    withDoses(d, 'shred', 4, 18);

    expect(sleepTarget(d, END).note).not.toMatch(/16:00/);
  });
});
