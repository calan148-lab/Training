import Dexie, { type Table } from 'dexie';
import { HEALTH_DAY_CAP, SCHEMA_VERSION, freshData, type AppData } from './domain/types';

/** localStorage key the original single-file app wrote to. */
export const LEGACY_KEY = 'calis8w';
/** Untouched copy of the legacy payload, kept so a bad migration is recoverable. */
export const LEGACY_BACKUP_KEY = 'calis8w.v1.backup';

interface StateRow {
  id: 'app';
  data: AppData;
}

interface PhotoRow {
  /** Same id as the Meal it belongs to. */
  id: string;
  blob: Blob;
}

class TrainingDB extends Dexie {
  state!: Table<StateRow, string>;
  photos!: Table<PhotoRow, string>;

  constructor() {
    super('training-log');
    this.version(1).stores({ state: 'id', photos: 'id' });
  }
}

export const db = new TrainingDB();

/**
 * Bring any older shape up to the current one.
 *
 * Runs on app boot *and* on backup import — a v1 backup restored into a v2 app
 * would otherwise land without `health`, `meals` or `settings` and crash on
 * first read.
 */
export function migrate(raw: unknown): AppData {
  const base = freshData();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<AppData> & Record<string, unknown>;

  const d: AppData = {
    ...base,
    ...o,
    v: SCHEMA_VERSION,
    start: typeof o.start === 'string' ? o.start : base.start,
    ladders: { ...base.ladders, ...(o.ladders ?? {}) },
    sessions: Array.isArray(o.sessions) ? o.sessions : [],
    weights: Array.isArray(o.weights) ? o.weights : [],
    seen: Array.isArray(o.seen) ? o.seen : [],
    profile: { ...base.profile, ...(o.profile ?? {}) },
    health: {
      lastSync: o.health?.lastSync ?? null,
      src: o.health?.src ?? null,
      days: o.health?.days ?? {},
    },
    meals: Array.isArray(o.meals) ? o.meals : [],
    supplements: Array.isArray(o.supplements) ? o.supplements : [],
    doses: Array.isArray(o.doses) ? o.doses : [],
    settings: { ...base.settings, ...(o.settings ?? {}) },
  };
  return trimHealth(d);
}

/** Keep only the most recent HEALTH_DAY_CAP days, so storage stays bounded. */
export function trimHealth(d: AppData): AppData {
  const dates = Object.keys(d.health.days);
  if (dates.length <= HEALTH_DAY_CAP) return d;
  const keep = dates.sort().slice(-HEALTH_DAY_CAP);
  const days: AppData['health']['days'] = {};
  for (const k of keep) days[k] = d.health.days[k]!;
  return { ...d, health: { ...d.health, days } };
}

/**
 * Read the legacy localStorage payload, if the phone still has one.
 * Returns null when there is nothing to migrate or the value is unparseable.
 */
export function readLegacy(): unknown | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load app state, migrating from localStorage on first run.
 *
 * The legacy payload is never deleted and is copied to a separate backup key
 * before anything else happens: this is somebody's actual training block, and a
 * port that eats it is a failed port.
 */
export async function loadData(): Promise<AppData> {
  const row = await db.state.get('app');
  if (row) return migrate(row.data);

  const legacy = readLegacy();
  if (legacy) {
    try {
      if (!localStorage.getItem(LEGACY_BACKUP_KEY)) {
        localStorage.setItem(LEGACY_BACKUP_KEY, localStorage.getItem(LEGACY_KEY)!);
      }
    } catch {
      /* private mode or quota — migration still proceeds */
    }
    const migrated = migrate(legacy);
    await saveData(migrated);
    return migrated;
  }

  const fresh = freshData();
  await saveData(fresh);
  return fresh;
}

export async function saveData(data: AppData): Promise<void> {
  await db.state.put({ id: 'app', data: trimHealth(data) });
}

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  await db.photos.put({ id, blob });
}

export async function getPhoto(id: string): Promise<Blob | undefined> {
  return (await db.photos.get(id))?.blob;
}

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id);
}
