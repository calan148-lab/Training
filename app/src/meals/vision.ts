import type { Meal, MealItem, MealTotals, Settings, SupplementKind } from '../domain/types';

/** Longest edge, in pixels, that we upload. */
export const MAX_EDGE = 1024;
export const JPEG_QUALITY = 0.8;

export interface MealEstimate {
  items: MealItem[];
  total: MealTotals;
  assumptions: string[];
  usage?: Record<string, number>;
}

/** What the model reports from a supplement label. Nulls mean "not stated". */
export interface SupplementEstimate {
  name: string;
  brand: string;
  kind: SupplementKind;
  servingLabel: string;
  servingsPerContainer: number | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  caffeine_mg: number | null;
  creatine_g: number | null;
  confidence: number;
  assumptions: string[];
  usage?: Record<string, number>;
}

export class VisionError extends Error {
  constructor(
    message: string,
    /** Whether trying the same photo again could plausibly work. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Downscale and re-encode before upload.
 *
 * A modern phone photo is 3-4 MB and ~4000px wide; the model gains nothing from
 * the extra pixels, and image tokens scale with area — this is the single change
 * that keeps a photo costing about two cents instead of twenty.
 */
export async function downscale(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new VisionError('Could not prepare the photo on this device.', false);
    ctx.drawImage(bitmap, 0, 0, w, h);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new VisionError('Could not encode the photo.', false))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so a large photo doesn't blow the argument limit on spread.
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function settingsReady(s: Settings): boolean {
  return Boolean(s.workerUrl && s.workerToken);
}

/**
 * Downscale a photo, send it to one Worker route, and return the parsed body.
 *
 * Shared by both routes because everything that can go wrong here — offline,
 * a bad token, a rate limit, a 5xx — is identical whichever panel is in frame,
 * and the retryable/not distinction is the part callers actually depend on.
 */
async function postPhoto(
  path: string,
  photo: Blob,
  settings: Settings,
  hint?: string,
): Promise<unknown> {
  if (!settingsReady(settings)) {
    throw new VisionError('Photo recognition needs a server. Add one in Settings.', false);
  }
  const small = await downscale(photo);
  const image = await blobToBase64(small);

  let res: Response;
  try {
    res = await fetch(`${settings.workerUrl!.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.workerToken}`,
      },
      body: JSON.stringify({
        image,
        mediaType: 'image/jpeg',
        hint,
        ...(settings.model ? { model: settings.model } : {}),
      }),
    });
  } catch {
    // Offline, or the server is down. The outbox will try again.
    throw new VisionError('No connection to the server — queued for later.', true);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON error body */
    }
    // 401 and 400 will never succeed on retry; 429 and 5xx might.
    const retryable = res.status === 429 || res.status >= 500;
    throw new VisionError(detail || `Server returned ${res.status}.`, retryable);
  }

  return await res.json();
}

/** Send one meal photo for estimation. Throws VisionError with a retryable flag. */
export async function estimateMeal(
  photo: Blob,
  settings: Settings,
  hint?: string,
): Promise<MealEstimate> {
  const data = (await postPhoto('/meal', photo, settings, hint)) as MealEstimate;
  if (!Array.isArray(data.items) || !data.total) {
    throw new VisionError('Server sent back something unexpected.', false);
  }
  return data;
}

/**
 * Read one supplement label.
 *
 * The label is read once and its numbers reused for every dose, so a misread is
 * repeated daily rather than averaged away. Anything the model could not read
 * comes back null and stays null — the confirmation screen asks you for it
 * rather than inventing a plausible figure.
 */
export async function estimateSupplement(
  photo: Blob,
  settings: Settings,
  hint?: string,
): Promise<SupplementEstimate> {
  const data = (await postPhoto('/supplement', photo, settings, hint)) as SupplementEstimate;
  if (typeof data?.name !== 'string' || typeof data?.kind !== 'string') {
    throw new VisionError('Server sent back something unexpected.', false);
  }
  return data;
}

/** Recompute totals after the portions have been edited. */
export function totalsOf(items: MealItem[]): MealTotals {
  return items.reduce<MealTotals>(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      protein_g: a.protein_g + i.protein_g,
      carbs_g: a.carbs_g + i.carbs_g,
      fat_g: a.fat_g + i.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

/** Rescale one item's mass and everything that follows from it. */
export function scaleItem(item: MealItem, factor: number): MealItem {
  return {
    ...item,
    grams: Math.round(item.grams * factor),
    kcal: Math.round(item.kcal * factor),
    protein_g: Math.round(item.protein_g * factor * 10) / 10,
    carbs_g: Math.round(item.carbs_g * factor * 10) / 10,
    fat_g: Math.round(item.fat_g * factor * 10) / 10,
  };
}

/**
 * Meals eaten before, most recent first, deduped by their item names — the
 * basis of "same as last time", which skips the photo entirely for a repeat.
 */
export function repeatCandidates(meals: Meal[], limit = 8): Meal[] {
  const seen = new Set<string>();
  const out: Meal[] = [];
  for (const m of [...meals].reverse()) {
    if (m.status !== 'confirmed' || !m.items.length) continue;
    const key = m.items.map((i) => i.name.toLowerCase()).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}
