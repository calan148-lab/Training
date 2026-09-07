import { useEffect, useMemo, useState } from 'react';
import { LADDERS, SESSIONS, SNAME } from '../domain/plan';
import { calcXP, planFor, rankOf, thisWeekCount, weekNo } from '../domain/progress';
import { SupplementDoses } from './Supplements';
import type { AppData, LadderKey, SessionType } from '../domain/types';
import { todayISO } from '../domain/types';
import { evaluateTargets } from '../targets/engine';
import type { Store } from '../useAppData';
import { StatusStrip } from '../components/StatusStrip';

const DL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function Calendar({ d, onPick }: { d: AppData; onPick: (t: SessionType) => void }) {
  const now = new Date();
  const today = todayISO(now);
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);

  const done = new Set(d.sessions.map((s) => s.date));
  const cells = [...Array(7)].map((_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const iso = todayISO(day);
    const plan = planFor(d, iso);
    return {
      iso,
      plan,
      n: day.getDate(),
      isToday: iso === today,
      isFuture: iso > today,
      done: done.has(iso),
      label: DL[i]!,
    };
  });
  const todayCell = cells[dow]!;

  return (
    <div className="cal">
      <div className="calTop">
        <b>This week</b>
        <span>
          {cells.filter((c) => c.done).length} / {cells.filter((c) => c.plan).length} done
        </span>
      </div>
      <div className="days">
        {cells.map((c) => (
          <div
            key={c.iso}
            className={`day${c.isToday ? ' today' : ''}${c.done ? ' done' : ''}${c.isFuture ? ' future' : ''}`}
            role={c.plan ? 'button' : undefined}
            tabIndex={c.plan ? 0 : undefined}
            onClick={() => c.plan && onPick(c.plan)}
            onKeyDown={(e) => {
              if (c.plan && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onPick(c.plan);
              }
            }}
          >
            <span className="dl">{c.label}</span>
            <span className={`sq ${c.plan ? (c.plan === 'C' ? 'c' : 's') : 'off'}`}>{c.plan || '·'}</span>
            <span className="dn">{c.n}</span>
          </div>
        ))}
      </div>
      <div className="todayLine">
        {todayCell.plan ? (
          <>
            Today: <b>{SNAME[todayCell.plan]}</b>
            {todayCell.done ? ' — done' : ''}
          </>
        ) : (
          <>
            Today: <b>Rest</b>
          </>
        )}
      </div>
    </div>
  );
}

function Rank({ d }: { d: AppData }) {
  const xp = calcXP(d);
  const { i, r, next } = rankOf(xp);
  const pct = next ? Math.min(100, ((xp - r.xp) / (next.xp - r.xp)) * 100) : 100;
  return (
    <div className="rank">
      <div className="rankTop">
        <div>
          <div className="rankName">{r.n}</div>
          <div className="rankXp">{next ? `${xp} / ${next.xp} XP` : `${xp} XP`}</div>
        </div>
        <div className="ring" style={{ ['--p' as string]: `${pct}%` }}>
          <span>
            {i + 1}
            <i>rank</i>
          </span>
        </div>
      </div>
      <div className="xpbar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="rankFoot">
        {next ? `${next.xp - xp} XP to ${next.n}` : 'Top rank reached'}
      </div>
    </div>
  );
}

export function Today({ store }: { store: Store }) {
  const d = store.data!;
  const [cur, setCur] = useState<SessionType>('A');
  const [coreMode, setCoreMode] = useState<LadderKey>('core');
  const [rounds, setRounds] = useState(0);
  const [reps, setReps] = useState<Record<string, string>>({});
  const [rest, setRest] = useState<{ end: number; total: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  // Preselect whatever today's plan calls for.
  useEffect(() => {
    const p = planFor(d, todayISO());
    if (p) setCur(p);
    // Only on mount: after that, the picker is the user's to drive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rest) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [rest]);

  const left = rest ? Math.max(0, Math.ceil((rest.end - now) / 1000)) : 0;
  useEffect(() => {
    if (rest && left <= 0) {
      if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
      store.say('⏱ Rest done — go');
      setRest(null);
    }
  }, [rest, left, store]);

  const verdict = useMemo(() => evaluateTargets(d), [d]);

  const startRest = (sec: number) => {
    setNow(Date.now());
    setRest({ end: Date.now() + sec * 1000, total: sec });
    if (navigator.vibrate) navigator.vibrate(40);
  };

  const save = () => {
    const date = todayISO();
    if (cur === 'C') {
      if (!rounds) return store.say('Log at least one round');
      store.update((s) => ({ ...s, sessions: [...s.sessions, { date, type: 'C', rounds }] }));
      setRounds(0);
    } else {
      const ex = SESSIONS[cur].ex;
      const vals: number[] = [];
      let pullBest = 0;
      ex.forEach((e, i) => {
        for (let j = 0; j < e.sets; j++) {
          const v = Number(reps[`${i}-${j}`] ?? '') || 0;
          vals.push(v);
          if (e.k === 'pullup') pullBest = Math.max(pullBest, v);
        }
      });
      if (!vals.some((v) => v > 0)) return store.say('Nothing to save yet');
      store.update((s) => ({
        ...s,
        sessions: [...s.sessions, { date, type: cur, sets: vals, best: { pullup: pullBest } }],
      }));
      setReps({});
    }
    store.say('Session saved');
  };

  return (
    <section className="view on">
      {/*
        Two panes: the state of the week on the left, the session you are
        actually doing on the right. Both are display:contents until an iPad
        is wide enough to hold them side by side, so a phone still gets one
        column in exactly this order.
      */}
      <div className="split splitAside">
        <div className="pane paneSide">
          <Calendar d={d} onPick={setCur} />
          <Rank d={d} />
          <StatusStrip verdict={verdict} />
        </div>

        <div className="pane paneMain">
          <div className="picker">
            {(['A', 'B', 'C'] as SessionType[]).map((t) => (
              <button key={t} aria-pressed={cur === t} onClick={() => setCur(t)}>
                <span className="let">{t}</span>
                <span className="nm">{SNAME[t]}</span>
              </button>
            ))}
          </div>

          {cur === 'C' ? (
            <div className="circuit">
              <ul>
                <li>4 pull-ups</li>
                <li>8 pushups</li>
                <li>12 air squats</li>
                <li>20s hollow hold</li>
              </ul>
              <div className="bignum">
                <button onClick={() => setRounds((n) => Math.max(0, n - 1))} aria-label="One fewer round">
                  −
                </button>
                <span>{rounds}</span>
                <button onClick={() => setRounds((n) => n + 1)} aria-label="One more round">
                  +
                </button>
              </div>
              <small>Rounds in 20 minutes</small>
            </div>
          ) : (
            SESSIONS[cur].ex.map((e, i) => {
              const key = (e.k === 'core' ? coreMode : e.k) as LadderKey;
              const ladder = LADDERS[key];
              const name = e.n ?? ladder?.name ?? e.k;
              const varia = e.v ?? ladder?.steps[d.ladders[key] ?? 0] ?? '';
              return (
                <div className="ex" key={`${cur}-${i}`}>
                  <div className="ex-top">
                    <span className="ex-name">{name}</span>
                    <span className="ex-target">{e.t}</span>
                  </div>
                  <div className="ex-var">{varia}</div>
                  <div className="sets">
                    {[...Array(e.sets)].map((_, j) => {
                      const id = `${i}-${j}`;
                      const v = reps[id] ?? '';
                      return (
                        <input
                          key={id}
                          type="number"
                          inputMode="numeric"
                          placeholder="—"
                          aria-label={`${name} set ${j + 1}`}
                          className={Number(v) >= e.top ? 'hit' : ''}
                          value={v}
                          onChange={(ev) => setReps((r) => ({ ...r, [id]: ev.target.value }))}
                        />
                      );
                    })}
                  </div>
                  <div className="ex-foot">
                    <a
                      className="form"
                      target="_blank"
                      rel="noopener"
                      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${e.n ?? varia} proper form tutorial`)}`}
                    >
                      Form check ↗
                    </a>
                    <button type="button" className="restBtn" onClick={() => startRest(e.rest)}>
                      ⏱ Rest {e.rest}s
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {cur === 'A' && (
            <div className="swap">
              <span>Core</span>
              <button aria-pressed={coreMode === 'core'} onClick={() => setCoreMode('core')}>
                Hanging
              </button>
              <button aria-pressed={coreMode === 'floor'} onClick={() => setCoreMode('floor')}>
                Floor
              </button>
            </div>
          )}

          <SupplementDoses store={store} />

          <button className="act" style={{ marginTop: 14 }} onClick={save}>
            Save session
          </button>
          <p className="note">
            Hit the top of the rep range on every set, twice in a row? Go to Ladders and climb a rung.
          </p>
          <p className="note" style={{ marginTop: 18 }}>
            Week {weekNo(d)} of 8 · {thisWeekCount(d)} sessions this week
          </p>
        </div>
      </div>

      {rest && (
        <div className="restBar show">
          <div className="rt-fill" style={{ width: `${(left / rest.total) * 100}%` }} />
          <span className="rt-time">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </span>
          <span className="rt-label">Resting…</span>
          <button type="button" onClick={() => setRest((r) => (r ? { ...r, end: r.end + 15000 } : r))}>
            +15s
          </button>
          <button type="button" onClick={() => setRest(null)}>
            Skip
          </button>
        </div>
      )}
    </section>
  );
}
