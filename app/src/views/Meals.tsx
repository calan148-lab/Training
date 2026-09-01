import { useCallback, useEffect, useRef, useState } from 'react';
import { deletePhoto, getPhoto, putPhoto } from '../db';
import { todayISO, type Meal, type MealItem } from '../domain/types';
import { intakeByDay } from '../targets/engine';
import {
  VisionError,
  estimateMeal,
  repeatCandidates,
  scaleItem,
  settingsReady,
  totalsOf,
} from '../meals/vision';
import type { Store } from '../useAppData';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Editing one estimate before it counts toward anything. */
function Confirm({
  meal,
  onSave,
  onDiscard,
}: {
  meal: Meal;
  onSave: (items: MealItem[]) => void;
  onDiscard: () => void;
}) {
  const [items, setItems] = useState(meal.items);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    void getPhoto(meal.id).then((b) => {
      if (b) {
        url = URL.createObjectURL(b);
        setPhoto(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [meal.id]);

  const totals = totalsOf(items);
  const scale = (i: number, factor: number) =>
    setItems((cur) => cur.map((it, j) => (j === i ? scaleItem(it, factor) : it)));
  const setGrams = (i: number, grams: number) =>
    setItems((cur) =>
      cur.map((it, j) => (j === i && it.grams > 0 ? scaleItem(it, grams / it.grams) : it)),
    );

  return (
    <div className="confirm">
      <h3 className="sub">Check this before it counts</h3>
      {photo && <img className="mealshot" src={photo} alt="The meal being logged" />}

      {items.map((it, i) => (
        <div className="ex" key={`${it.name}-${i}`}>
          <div className="ex-top">
            <span className="ex-name">{it.name}</span>
            <span className="ex-target">{Math.round(it.kcal)} kcal</span>
          </div>
          <div className="ex-var">
            {it.portionEstimate} · {it.grams} g · P {it.protein_g} / C {it.carbs_g} / F {it.fat_g}
            {it.confidence < 0.5 && <strong className="lowconf"> · low confidence</strong>}
          </div>
          <div className="wrow" style={{ marginTop: 8 }}>
            <button className="ghost" onClick={() => scale(i, 0.5)}>
              ½×
            </button>
            <button className="ghost" onClick={() => scale(i, 2)}>
              2×
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={it.grams}
              aria-label={`${it.name} grams`}
              onChange={(e) => setGrams(i, Number(e.target.value) || 0)}
            />
            <button className="ghost" onClick={() => setItems((c) => c.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}

      {!!meal.assumptions.length && (
        <div className="assume">
          <b>What it had to guess</b>
          <ul>
            {meal.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="totals">
        <b>{Math.round(totals.kcal)} kcal</b>
        <span>
          P {Math.round(totals.protein_g)} · C {Math.round(totals.carbs_g)} · F {Math.round(totals.fat_g)}
        </span>
      </div>

      <button className="act" onClick={() => onSave(items)}>
        Looks right — log it
      </button>
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}

export function Meals({ store }: { store: Store }) {
  const d = store.data!;
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const camRef = useRef<HTMLInputElement>(null);

  const pending = d.meals.find((m) => m.status === 'estimated');
  const today = todayISO();
  const todayTotals = intakeByDay(d).get(today) ?? { kcal: 0, protein: 0 };
  const ready = settingsReady(d.settings);

  const setMeal = useCallback(
    (id: string, fn: (m: Meal) => Meal) =>
      store.update((s) => ({ ...s, meals: s.meals.map((m) => (m.id === id ? fn(m) : m)) })),
    [store],
  );

  /** Send one queued photo. Shared by capture and by the outbox retry. */
  const send = useCallback(
    async (meal: Meal) => {
      const blob = await getPhoto(meal.id);
      if (!blob) {
        setMeal(meal.id, (m) => ({ ...m, status: 'failed', error: 'Photo is missing.' }));
        return;
      }
      try {
        const est = await estimateMeal(blob, d.settings, meal.hint);
        setMeal(meal.id, (m) => ({
          ...m,
          status: 'estimated',
          items: est.items,
          totals: est.total,
          assumptions: est.assumptions ?? [],
          error: undefined,
        }));
      } catch (e) {
        const err = e instanceof VisionError ? e : new VisionError('Something went wrong.', false);
        setMeal(meal.id, (m) => ({
          ...m,
          // A retryable failure stays queued so the outbox picks it up again;
          // a permanent one stops so it can be dealt with.
          status: err.retryable ? 'pending' : 'failed',
          error: err.message,
          attempts: (m.attempts ?? 0) + 1,
        }));
        store.say(err.message);
      }
    },
    [d.settings, setMeal, store],
  );

  const capture = async (file: File) => {
    const id = newId();
    setBusy(true);
    try {
      await putPhoto(id, file);
      const meal: Meal = {
        id,
        date: today,
        at: new Date().toISOString(),
        status: 'pending',
        items: [],
        totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
        assumptions: [],
        ...(hint.trim() ? { hint: hint.trim() } : {}),
      };
      store.update((s) => ({ ...s, meals: [...s.meals, meal] }));
      setHint('');
      await send(meal);
    } finally {
      setBusy(false);
    }
  };

  // Outbox: flush anything still pending when connectivity returns.
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      const queued = d.meals.filter((m) => m.status === 'pending' && (m.attempts ?? 0) < 5);
      // One at a time — a queue of photos should not fan out into parallel calls.
      if (queued[0]) void send(queued[0]);
    };
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [d.meals, ready, send]);

  const confirm = (meal: Meal, items: MealItem[]) => {
    setMeal(meal.id, (m) => ({ ...m, status: 'confirmed', items, totals: totalsOf(items) }));
    void deletePhoto(meal.id);
    store.say('Meal logged');
  };

  const discard = (meal: Meal) => {
    store.update((s) => ({ ...s, meals: s.meals.filter((m) => m.id !== meal.id) }));
    void deletePhoto(meal.id);
  };

  const relog = (src: Meal) => {
    store.update((s) => ({
      ...s,
      meals: [
        ...s.meals,
        { ...src, id: newId(), date: today, at: new Date().toISOString(), status: 'confirmed' },
      ],
    }));
    store.say('Logged again');
  };

  return (
    <section className="view on">
      <h2>Today's food</h2>
      <div className="stats">
        <div className="stat">
          <b>{Math.round(todayTotals.kcal)}</b>
          <span>kcal today</span>
        </div>
        <div className="stat">
          <b>{Math.round(todayTotals.protein)}</b>
          <span>g protein</span>
        </div>
      </div>

      {!ready && (
        <p className="note warnbox">
          Photo calories need a server holding the API key — a browser can't keep one safely. Add the
          address and token in Settings; everything else on this page works without it.
        </p>
      )}

      {pending ? (
        <Confirm meal={pending} onSave={(items) => confirm(pending, items)} onDiscard={() => discard(pending)} />
      ) : (
        <>
          <input
            className="paste"
            placeholder="Optional: anything the photo won't show — 'cooked in butter', 'fork for scale'"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
          />
          <button className="act" disabled={busy || !ready} onClick={() => camRef.current?.click()}>
            {busy ? 'Reading the photo…' : '📷 Photograph a meal'}
          </button>
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void capture(f);
              e.target.value = '';
            }}
          />
          <p className="note">
            The estimate is a starting point, not a measurement — portion size is the part a photo
            can't tell you, so check it before logging. Consistency matters more than precision here:
            the app works out your maintenance from your own intake against your weight trend, so a
            steady bias mostly cancels out.
          </p>
        </>
      )}

      {!!repeatCandidates(d.meals).length && !pending && (
        <>
          <h2>Same as last time</h2>
          <ul className="log">
            {repeatCandidates(d.meals).map((m) => (
              <li key={m.id}>
                <span>{m.items.map((i) => i.name).join(', ')}</span>
                <button className="ghost" onClick={() => relog(m)}>
                  {Math.round(m.totals.kcal)} kcal · log
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Recent meals</h2>
      <ul className="log">
        {d.meals.length ? (
          [...d.meals]
            .slice(-15)
            .reverse()
            .map((m) => (
              <li key={m.id}>
                <span>
                  {m.date} · {m.items.map((i) => i.name).join(', ') || m.status}
                  {m.error && <em className="lowconf"> — {m.error}</em>}
                </span>
                <b>{m.status === 'confirmed' ? `${Math.round(m.totals.kcal)} kcal` : m.status}</b>
              </li>
            ))
        ) : (
          <li>
            <span>Nothing logged yet.</span>
          </li>
        )}
      </ul>
    </section>
  );
}
