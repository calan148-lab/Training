import { LADDERS } from '../domain/plan';
import type { LadderKey } from '../domain/types';
import type { Store } from '../useAppData';

export function Ladders({ store }: { store: Store }) {
  const d = store.data!;
  const climb = (k: LadderKey, i: number) => {
    store.update((s) => ({ ...s, ladders: { ...s.ladders, [k]: i } }));
    store.say('+250 XP · rung set');
  };

  return (
    <section className="view on">
      <h2>Progressions</h2>
      <p className="note" style={{ margin: '0 0 18px' }}>
        Tap a rung when you own it. Hit the top of the rep range on every set, twice running, then move up.
      </p>
      <div className="cardGrid">
        {(Object.keys(LADDERS) as LadderKey[]).map((k) => {
          const L = LADDERS[k];
          const at = d.ladders[k];
          return (
            <div className="ladder" key={k}>
              <h3>{L.name}</h3>
              <div className="cur">
                Rung {at + 1} of {L.steps.length} — {L.steps[at]}
              </div>
              <div className="rungs">
                {L.steps.map((s, i) => (
                  <div
                    key={s}
                    className={`rung ${i < at ? 'done' : i === at ? 'here' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => climb(k, i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        climb(k, i);
                      }
                    }}
                  >
                    <span className="rail">
                      <span className="bar" />
                    </span>
                    <span className="lbl">{s}</span>
                    <span className="n">{i + 1}</span>
                  </div>
                ))}
              </div>
              <a
                className="form"
                target="_blank"
                rel="noopener"
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${L.steps[at]} ${L.name} tutorial`)}`}
              >
                Form check — {L.steps[at]} ↗
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}
