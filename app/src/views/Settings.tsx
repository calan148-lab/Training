import { LEGACY_BACKUP_KEY } from '../db';
import type { Goal } from '../domain/types';
import type { Store } from '../useAppData';

const GOALS: Array<{ id: Goal; name: string; blurb: string }> = [
  { id: 'gain', name: 'Lean gain', blurb: '+0.25 to +0.5 kg a month' },
  { id: 'recomp', name: 'Recomp', blurb: 'hold weight, add strength' },
  { id: 'cut', name: 'Fat loss', blurb: '−0.25 to −0.5 kg a week' },
];

export function Settings({ store }: { store: Store }) {
  const d = store.data!;
  const s = d.settings;
  const set = (patch: Partial<typeof s>) =>
    store.update((cur) => ({ ...cur, settings: { ...cur.settings, ...patch } }));
  const setProfile = (patch: Partial<typeof d.profile>) =>
    store.update((cur) => ({ ...cur, profile: { ...cur.profile, ...patch } }));

  const hasLegacyBackup = (() => {
    try {
      return Boolean(localStorage.getItem(LEGACY_BACKUP_KEY));
    } catch {
      return false;
    }
  })();

  return (
    <section className="view on">
      <div className="split">
        <div className="pane">
          <h2>Goal</h2>
          <p className="note" style={{ margin: '0 0 12px' }}>
            This sets the weight band every other target is judged against, and the calorie surplus is
            derived from it rather than guessed separately.
          </p>
          <div className="picker">
            {GOALS.map((g) => (
              <button key={g.id} aria-pressed={d.profile.goal === g.id} onClick={() => setProfile({ goal: g.id })}>
                <span className="nm">{g.name}</span>
                <span className="let" style={{ fontSize: 10, letterSpacing: 0 }}>
                  {g.blurb}
                </span>
              </button>
            ))}
          </div>

          <h2>About you</h2>
          <p className="note" style={{ margin: '0 0 12px' }}>
            Only used for a starting maintenance estimate before there's enough of your own data. Once
            you have a fortnight of meals and weigh-ins, your real numbers replace it and these stop
            mattering.
          </p>
          <div className="wrow">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Height cm"
              aria-label="Height in centimetres"
              value={d.profile.heightCm ?? ''}
              onChange={(e) => setProfile({ heightCm: Number(e.target.value) || undefined })}
            />
            <input
              type="number"
              inputMode="numeric"
              placeholder="Age"
              aria-label="Age"
              value={d.profile.age ?? ''}
              onChange={(e) => setProfile({ age: Number(e.target.value) || undefined })}
            />
          </div>
          <div className="picker" style={{ marginTop: 8 }}>
            <button aria-pressed={d.profile.sex === 'male'} onClick={() => setProfile({ sex: 'male' })}>
              <span className="nm">Male</span>
            </button>
            <button aria-pressed={d.profile.sex === 'female'} onClick={() => setProfile({ sex: 'female' })}>
              <span className="nm">Female</span>
            </button>
          </div>

        </div>

        <div className="pane">
          <h2>Photo calorie server</h2>
          <p className="note" style={{ margin: '0 0 12px' }}>
            An API key can't live in a web page — anyone could read it. It sits in a small Worker you
            deploy instead; see <code>DEPLOY.md</code>. The token below is what stops a stranger who
            finds the address from spending your credits, so it is stored only on this device and never
            goes in the repo.
          </p>
          <input
            className="paste"
            type="url"
            placeholder="https://training-meals.your-name.workers.dev"
            aria-label="Worker address"
            value={s.workerUrl ?? ''}
            onChange={(e) => set({ workerUrl: e.target.value.trim() || undefined })}
          />
          <input
            className="paste"
            type="password"
            placeholder="Access token"
            aria-label="Worker access token"
            value={s.workerToken ?? ''}
            onChange={(e) => set({ workerToken: e.target.value.trim() || undefined })}
          />
          <input
            className="paste"
            placeholder="Model (default claude-opus-5)"
            aria-label="Model"
            value={s.model ?? ''}
            onChange={(e) => set({ model: e.target.value.trim() || undefined })}
          />
          <p className="note">
            Leave the model blank unless you want to trade accuracy for cost. Opus 5 runs about 2p a
            photo; Haiku 4.5 is roughly a fifth of that and noticeably weaker at judging portions.
          </p>

          {hasLegacyBackup && (
            <>
              <h2>Migration</h2>
              <p className="note">
                Your original training log was migrated from this browser's local storage. The untouched
                copy is still there under <code>{LEGACY_BACKUP_KEY}</code>, so nothing was lost.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
