import { useEffect, useState } from 'react';
import { deletePhoto, getPhoto, putPhoto } from '../db';
import { estimateSupplement, VisionError, type SupplementEstimate } from '../meals/vision';
import { settingsReady } from '../meals/vision';
import { todayISO, type Supplement, type SupplementKind } from '../domain/types';
import type { Store } from '../useAppData';

const KINDS: Array<{ id: SupplementKind; label: string; blurb: string }> = [
  { id: 'nutritive', label: 'Nutritive', blurb: 'counts toward calories and protein' },
  { id: 'creatine', label: 'Creatine', blurb: 'moves scale weight by water' },
  { id: 'stimulant', label: 'Stimulant', blurb: 'affects resting HR, HRV and sleep' },
  { id: 'other', label: 'Other', blurb: 'adherence only' },
];

function newId(): string {
  return crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function kindBlurb(k: SupplementKind): string {
  return KINDS.find((x) => x.id === k)?.blurb ?? '';
}

/** A number input that keeps "not stated" distinct from zero. */
function NumField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
}) {
  return (
    <label className="numfield">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        type="number"
        inputMode="decimal"
        placeholder="—"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
      />
    </label>
  );
}

/**
 * Confirmation before a label becomes a product.
 *
 * A meal estimate is wrong once; a label estimate is wrong every day it is
 * reused, so this screen is deliberately editable rather than a yes/no.
 */
function Confirm({
  draft,
  photoUrl,
  onSave,
  onDiscard,
}: {
  draft: SupplementEstimate;
  photoUrl?: string;
  onSave: (s: Omit<Supplement, 'id' | 'photoId' | 'addedAt'>) => void;
  onDiscard: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [brand, setBrand] = useState(draft.brand);
  const [kind, setKind] = useState<SupplementKind>(draft.kind);
  const [serving, setServing] = useState(draft.servingLabel);
  const [kcal, setKcal] = useState(draft.kcal ?? undefined);
  const [protein, setProtein] = useState(draft.protein_g ?? undefined);
  const [carbs, setCarbs] = useState(draft.carbs_g ?? undefined);
  const [fat, setFat] = useState(draft.fat_g ?? undefined);
  const [caffeine, setCaffeine] = useState(draft.caffeine_mg ?? undefined);
  const [creatine, setCreatine] = useState(draft.creatine_g ?? undefined);

  return (
    <div className="confirm">
      <h3 className="sub">Check this before it counts</h3>
      {photoUrl && <img className="mealshot" src={photoUrl} alt="The supplement label being read" />}
      {draft.confidence < 0.5 && (
        <p className="note lowconf">
          Low confidence on this label — check every number below against the tub.
        </p>
      )}

      <label className="numfield">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="numfield">
        <span>Brand</span>
        <input value={brand} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <label className="numfield">
        <span>One serving</span>
        <input value={serving} onChange={(e) => setServing(e.target.value)} />
      </label>

      <h3 className="sub" style={{ marginTop: 14 }}>
        How it's treated
      </h3>
      <div className="picker">
        {KINDS.map((k) => (
          <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            <span className="nm">{k.label}</span>
            <span className="let" style={{ fontSize: 10, letterSpacing: 0 }}>
              {k.blurb}
            </span>
          </button>
        ))}
      </div>

      <h3 className="sub" style={{ marginTop: 14 }}>
        Per serving
      </h3>
      <div className="numgrid">
        <NumField label="Calories" value={kcal} onChange={setKcal} suffix="kcal" />
        <NumField label="Protein" value={protein} onChange={setProtein} suffix="g" />
        <NumField label="Carbs" value={carbs} onChange={setCarbs} suffix="g" />
        <NumField label="Fat" value={fat} onChange={setFat} suffix="g" />
        <NumField label="Caffeine" value={caffeine} onChange={setCaffeine} suffix="mg" />
        <NumField label="Creatine" value={creatine} onChange={setCreatine} suffix="g" />
      </div>
      {kind === 'nutritive' && kcal == null && (
        <p className="note">
          A nutritive supplement with no calories won't reach your intake totals. Fill these in from
          the tub.
        </p>
      )}

      {draft.assumptions.length > 0 && (
        <div className="assume">
          <b>Couldn't read, or inferred</b>
          <ul>
            {draft.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        className="act"
        onClick={() =>
          onSave({
            name: name.trim() || 'Unnamed supplement',
            brand: brand.trim() || undefined,
            kind,
            servingLabel: serving.trim() || '1 serving',
            kcal,
            protein_g: protein,
            carbs_g: carbs,
            fat_g: fat,
            caffeine_mg: caffeine,
            creatine_g: creatine,
          })
        }
      >
        Save supplement
      </button>
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}

/** Photograph a tub once and manage the products you own. */
export function SupplementManager({ store }: { store: Store }) {
  const d = store.data!;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ est: SupplementEstimate; photoId: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const ready = settingsReady(d.settings);

  useEffect(() => {
    if (!draft) {
      setPhotoUrl(undefined);
      return;
    }
    let url: string | undefined;
    void getPhoto(draft.photoId).then((b) => {
      if (b) {
        url = URL.createObjectURL(b);
        setPhotoUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft]);

  const capture = async (file: File) => {
    setBusy(true);
    const photoId = newId();
    try {
      await putPhoto(photoId, file);
      const est = await estimateSupplement(file, d.settings);
      setDraft({ est, photoId });
    } catch (e) {
      await deletePhoto(photoId);
      store.say(e instanceof VisionError ? e.message : 'Could not read that label.');
    } finally {
      setBusy(false);
    }
  };

  const save = (fields: Omit<Supplement, 'id' | 'photoId' | 'addedAt'>) => {
    const s: Supplement = {
      ...fields,
      id: newId(),
      photoId: draft?.photoId,
      addedAt: todayISO(),
    };
    store.update((cur) => ({ ...cur, supplements: [...cur.supplements, s] }));
    setDraft(null);
    store.say(`${s.name} added`);
  };

  const discard = () => {
    if (draft) void deletePhoto(draft.photoId);
    setDraft(null);
  };

  const remove = (s: Supplement) => {
    if (s.photoId) void deletePhoto(s.photoId);
    store.update((cur) => ({
      ...cur,
      supplements: cur.supplements.filter((x) => x.id !== s.id),
      // Doses of a deleted product would otherwise linger as untraceable rows.
      doses: cur.doses.filter((x) => x.supplementId !== s.id),
    }));
    store.say(`${s.name} removed`);
  };

  if (draft) {
    return <Confirm draft={draft.est} photoUrl={photoUrl} onSave={save} onDiscard={discard} />;
  }

  return (
    <>
      <h2>Supplements</h2>
      <p className="note" style={{ margin: '0 0 12px' }}>
        Photograph each tub once. After that you log a dose with one tap, and the app knows what to
        do with it — protein reaches your intake totals, creatine stops being read as fat, and a
        stimulant explains a resting heart rate that would otherwise look like fatigue.
      </p>

      {d.supplements.length === 0 && <p className="empty">Nothing added yet.</p>}

      {d.supplements.map((s) => (
        <div className="ex" key={s.id}>
          <div className="ex-top">
            <span className="ex-name">{s.name}</span>
            <span className="ex-target">{KINDS.find((k) => k.id === s.kind)?.label}</span>
          </div>
          <div className="ex-var">
            {s.brand ? `${s.brand} · ` : ''}
            {s.servingLabel}
            {s.kcal != null ? ` · ${Math.round(s.kcal)} kcal` : ''}
            {s.protein_g != null ? ` · ${Math.round(s.protein_g)} g protein` : ''}
            {s.caffeine_mg != null ? ` · ${Math.round(s.caffeine_mg)} mg caffeine` : ''}
            {s.creatine_g != null ? ` · ${s.creatine_g} g creatine` : ''}
          </div>
          <div className="ex-foot">
            <span className="note" style={{ margin: 0 }}>
              {kindBlurb(s.kind)}
            </span>
            <button type="button" className="ghost" onClick={() => remove(s)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      <label className={`act ${busy || !ready ? 'disabled' : ''}`} style={{ marginTop: 14 }}>
        {busy ? 'Reading the label…' : '📷 Add from photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          data-capture="supplement"
          hidden
          disabled={busy || !ready}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void capture(f);
          }}
        />
      </label>
      {!ready && (
        <p className="note">Reading labels needs the same server as photo meals. Add one in Settings.</p>
      )}
    </>
  );
}

/** The daily row: one tap per supplement taken. */
export function SupplementDoses({ store }: { store: Store }) {
  const d = store.data!;
  const today = todayISO();
  if (d.supplements.length === 0) return null;

  const takenToday = (id: string) =>
    d.doses.filter((x) => x.supplementId === id && x.date === today).length;

  const log = (s: Supplement) => {
    store.update((cur) => ({
      ...cur,
      doses: [
        ...cur.doses,
        {
          id: newId(),
          supplementId: s.id,
          date: today,
          // Local time, not UTC: a 19:00 stimulant is the point of recording this.
          at: new Date().toString(),
          servings: 1,
        },
      ],
    }));
    store.say(`${s.name} logged`);
  };

  const undo = (s: Supplement) => {
    const mine = d.doses.filter((x) => x.supplementId === s.id && x.date === today);
    const last = mine[mine.length - 1];
    if (!last) return;
    store.update((cur) => ({ ...cur, doses: cur.doses.filter((x) => x.id !== last.id) }));
  };

  return (
    <div className="supps">
      <div className="calTop">
        <b>Supplements today</b>
      </div>
      {d.supplements.map((s) => {
        const n = takenToday(s.id);
        return (
          <div className={`suppRow ${n ? 'done' : ''}`} key={s.id}>
            <button type="button" className="suppTake" onClick={() => log(s)}>
              <span className="suppName">{s.name}</span>
              <span className="suppMeta">
                {n ? `${n} × ${s.servingLabel}` : s.servingLabel}
              </span>
            </button>
            {n > 0 && (
              <button
                type="button"
                className="ghost suppUndo"
                aria-label={`Undo last ${s.name} dose`}
                onClick={() => undo(s)}
              >
                −
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
