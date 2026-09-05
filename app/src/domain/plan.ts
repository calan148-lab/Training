import type { LadderKey, SessionType } from './types';

export interface Ladder {
  name: string;
  steps: string[];
}

/** Progression ladders — you climb a rung when you top the rep range twice running. */
export const LADDERS: Record<LadderKey, Ladder> = {
  pullup: {
    name: 'Pull-up',
    steps: ['Dead hang 20-30s', 'Negatives, 5s lower', 'Band or foot assisted', 'Full pull-up', 'Slow tempo, 3s down', 'Archer pull-up', 'Weighted (backpack)'],
  },
  pushup: {
    name: 'Pushup',
    steps: ['Hands on table', 'Hands on chair', 'Standard pushup', 'Slow tempo + pause', 'Feet elevated', 'Diamond pushup', 'Archer pushup'],
  },
  pike: {
    name: 'Pike pushup',
    steps: ['Feet on floor', 'Feet on low step', 'Feet on chair', 'Wall handstand hold', 'Wall HSPU, partial', 'Wall HSPU, full'],
  },
  squat: {
    name: 'Squat',
    steps: ['Air squat', 'Slow tempo + pause', 'Split squat', 'Bulgarian split squat', 'Assisted pistol', 'Pistol squat'],
  },
  core: {
    name: 'Hanging core',
    steps: ['Hanging knee raise', 'Leg raise, bent', 'Leg raise, straight', 'Toes to bar'],
  },
  floor: {
    name: 'Floor core',
    steps: ['Reverse crunch, bent knees', 'Reverse crunch, slow 3s lower', 'Leg lowering, bent knees', 'Leg lowering, straight legs', 'Candlestick hip lift', 'V-up'],
  },
};

export interface Exercise {
  /** Ladder key when the exercise progresses on a ladder, else a bare id. */
  k: string;
  /** Explicit name for non-ladder exercises. */
  n?: string;
  /** Explicit variation text for non-ladder exercises. */
  v?: string;
  /** Target rep range, displayed. */
  t: string;
  sets: number;
  /** Top of the rep range — hitting it highlights the input. */
  top: number;
  /** Rest seconds between sets. */
  rest: number;
}

export const SESSIONS: Record<Exclude<SessionType, 'C'>, { title: string; ex: Exercise[] }> = {
  A: {
    title: 'Push emphasis',
    ex: [
      { k: 'pullup', t: '4 × 5-10', sets: 4, top: 10, rest: 90 },
      { k: 'pushup', t: '4 × 6-12', sets: 4, top: 12, rest: 60 },
      { k: 'pike', t: '4 × 6-12', sets: 4, top: 12, rest: 60 },
      { k: 'lat', n: 'Band lateral raise', v: '5 kg band · stand on it, arms to shoulder height', t: '4 × 15-20', sets: 4, top: 20, rest: 45 },
      { k: 'squat', t: '3 × 8-15', sets: 3, top: 15, rest: 60 },
      { k: 'core', t: '3 × 8-15', sets: 3, top: 15, rest: 45 },
    ],
  },
  B: {
    title: 'Pull emphasis',
    ex: [
      { k: 'pullup', t: '5 × 5-10', sets: 5, top: 10, rest: 90 },
      { k: 'row', n: 'Inverted row', v: 'Under a table, feet forward', t: '4 × 8-15', sets: 4, top: 15, rest: 60 },
      { k: 'dip', n: 'Dips', v: 'Between two chairs', t: '4 × 6-12', sets: 4, top: 12, rest: 75 },
      { k: 'face', n: 'Band face pull', v: '10 kg band · anchor high, pull to forehead', t: '3 × 15-20', sets: 3, top: 20, rest: 45 },
      { k: 'curl', n: 'Band curl', v: '10 kg band · stand on it', t: '3 × 10-15', sets: 3, top: 15, rest: 45 },
      { k: 'hollow', n: 'Hollow body hold', v: 'Seconds held', t: '3 × 20-40s', sets: 3, top: 40, rest: 30 },
    ],
  },
  D: {
    title: 'Core and abs',
    ex: [
      { k: 'core', t: '4 × 8-15', sets: 4, top: 15, rest: 60 },
      { k: 'floor', t: '3 × 8-15', sets: 3, top: 15, rest: 45 },
      { k: 'pallof', n: 'Pallof press', v: '10 kg band · anchor at chest height, press straight out, resist the twist', t: '3 × 10-12 each side', sets: 3, top: 12, rest: 45 },
      { k: 'sideplank', n: 'Side plank', v: 'Seconds held, each side', t: '3 × 20-45s', sets: 3, top: 45, rest: 30 },
    ],
  },
};

export const RANKS = [
  { xp: 0, n: 'Ground Floor' },
  { xp: 600, n: 'First Rung' },
  { xp: 1800, n: 'Foothold' },
  { xp: 3600, n: 'Halfway Up' },
  { xp: 6000, n: 'High Bar' },
  { xp: 9000, n: 'Topped Out' },
  { xp: 13000, n: 'Ironclad' },
] as const;

/**
 * The 8-week schedule — A and B alternate week to week. Monday-first.
 *
 * Wednesday holds the core day rather than the second full session it looks
 * like it could take: it lands 48 hours after Monday's trunk work, and putting
 * a heavy session there would leave no clear rest before Thursday. Sunday
 * stays genuinely empty.
 */
export const PLAN: SessionType[][] = [
  ['A', 'C', 'D', 'B', 'C', 'A', ''] as SessionType[],
  ['B', 'C', 'D', 'A', 'C', 'B', ''] as SessionType[],
];

export const SNAME: Record<SessionType, string> = { A: 'Push', B: 'Pull', C: 'Circuit', D: 'Core' };
