/** Session type: A = push emphasis, B = pull emphasis, C = 20-minute circuit. */
export type SessionType = 'A' | 'B' | 'C';

export type LadderKey = 'pullup' | 'pushup' | 'pike' | 'squat' | 'core' | 'floor';

export interface SessionRecord {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  type: SessionType;
  /** Circuit only: rounds completed in 20 minutes. */
  rounds?: number;
  /** A/B only: every set's reps, in exercise order. */
  sets?: number[];
  /** A/B only: best single set per tracked lift. */
  best?: { pullup?: number };
}

export interface WeightEntry {
  date: string;
  kg: number;
}

/**
 * One day of Apple Health data, already rolled up. We never store raw samples —
 * a real Health export holds hundreds of thousands of them.
 */
export interface HealthDay {
  /** Body mass, kg — last reading of the day. */
  wt?: number;
  /** Body fat, percent — last reading of the day. */
  bf?: number;
  /** Resting heart rate, bpm — mean. */
  rhr?: number;
  /** Heart rate variability SDNN, ms — mean. */
  hrv?: number;
  /** Time asleep, hours — summed intervals. */
  sleep?: number;
  /** Step count — summed. */
  steps?: number;
  /** Active energy burned, kcal — summed. */
  aen?: number;
  /** Workout count. */
  wo?: number;
}

export type HealthSource = 'shortcut' | 'export';

export interface HealthState {
  lastSync: string | null;
  src: HealthSource | null;
  /** ISO date -> rollup. Trimmed to HEALTH_DAY_CAP most recent days. */
  days: Record<string, HealthDay>;
}

/** One food item within a meal, as identified from a photo or entered by hand. */
export interface MealItem {
  name: string;
  /** Human-readable portion, e.g. "1 medium bowl". */
  portionEstimate: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Model's confidence in this item, 0-1. */
  confidence: number;
}

export interface MealTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/**
 * `pending` — queued, photo not yet sent.
 * `estimated` — model replied; awaiting your confirmation.
 * `confirmed` — you accepted or corrected it; only these count toward targets.
 * `failed` — the request failed; retryable.
 */
export type MealStatus = 'pending' | 'estimated' | 'confirmed' | 'failed';

export interface Meal {
  id: string;
  /** ISO date the meal is attributed to. */
  date: string;
  /** Full ISO timestamp of capture. */
  at: string;
  status: MealStatus;
  items: MealItem[];
  totals: MealTotals;
  /** Model-stated assumptions, shown during confirmation. */
  assumptions: string[];
  /** Optional hint passed to the model, e.g. "fork in frame for scale". */
  hint?: string;
  /** Last error message when status is 'failed'. */
  error?: string;
  /** Attempts made, to back off on repeated failure. */
  attempts?: number;
}

/**
 * How a supplement interacts with the targets.
 *
 * This is why supplements are modelled rather than merely photographed: each
 * kind distorts a different target, and an engine that does not know what you
 * are taking will confidently mis-read its own numbers. Protein powder that
 * never reaches the intake totals makes the protein target read low and drags
 * measured maintenance down with it; creatine moves scale weight by pulling in
 * water, which the weight trend cannot tell from fat.
 */
export type SupplementKind =
  /** Contributes calories and macros — has to reach the intake totals. */
  | 'nutritive'
  /** Saturates muscle with water, moving scale weight independently of fat. */
  | 'creatine'
  /** Raises resting heart rate, suppresses HRV, and costs sleep taken late. */
  | 'stimulant'
  /** Logged for adherence only; touches no target. */
  | 'other';

/** A product you own. Photographed once, then logged by tap. */
export interface Supplement {
  id: string;
  name: string;
  brand?: string;
  kind: SupplementKind;
  /** How one serving is described on the tub, e.g. "1 scoop (30 g)". */
  servingLabel: string;
  /** Per serving. Only meaningful when kind is 'nutritive'. */
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  /** Per serving. Drives the stimulant and creatine annotations. */
  caffeine_mg?: number;
  creatine_g?: number;
  /** Key into the photo store — the label shot, kept once per product. */
  photoId?: string;
  addedAt: string;
}

/** One taking of one supplement. */
export interface SupplementDose {
  id: string;
  supplementId: string;
  /** ISO date the dose is attributed to. */
  date: string;
  /** Full timestamp. A stimulant at 19:00 means what one at 07:00 does not. */
  at: string;
  servings: number;
}

export type Goal = 'gain' | 'recomp' | 'cut';

export interface Profile {
  goal: Goal;
  /** Centimetres — only needed for the cold-start maintenance prior. */
  heightCm?: number;
  age?: number;
  sex?: 'male' | 'female';
}

export interface Settings {
  /** Base URL of the vision Worker, e.g. https://meals.example.workers.dev */
  workerUrl?: string;
  /** Bearer token checked by the Worker. Never committed; entered once. */
  workerToken?: string;
  /** Model the Worker should use. */
  model?: string;
}

/** The whole app state. Versioned so migrations are explicit. */
export interface AppData {
  v: number;
  /** ISO date the 8-week block started. */
  start: string;
  ladders: Record<LadderKey, number>;
  sessions: SessionRecord[];
  weights: WeightEntry[];
  /** Badge ids already awarded. */
  seen: string[];
  profile: Profile;
  health: HealthState;
  meals: Meal[];
  /** Products you own. */
  supplements: Supplement[];
  /** Individual takings, one row each. */
  doses: SupplementDose[];
  settings: Settings;
}

export const SCHEMA_VERSION = 3;
export const HEALTH_DAY_CAP = 400;

export function todayISO(d: Date = new Date()): string {
  // Local calendar date, not UTC — a 23:00 weigh-in belongs to today, not tomorrow.
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function freshData(): AppData {
  return {
    v: SCHEMA_VERSION,
    start: todayISO(),
    ladders: { pullup: 0, pushup: 0, pike: 0, squat: 0, core: 0, floor: 0 },
    sessions: [],
    weights: [],
    seen: [],
    profile: { goal: 'gain' },
    health: { lastSync: null, src: null, days: {} },
    meals: [],
    supplements: [],
    doses: [],
    settings: {},
  };
}
