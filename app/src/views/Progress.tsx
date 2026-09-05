import { useRef, useState } from 'react';
import { Bars } from '../components/Bars';
import { migrate } from '../db';
import { BADGES, allWeights, bestPull, bestRounds, thisWeekCount } from '../domain/progress';
import { todayISO } from '../domain/types';
import { weightTrendTarget } from '../targets/engine';
import type { Store } from '../useAppData';

export function Progress({ store }: { store: Store }) {
  const d = store.data!;
  const [kg, setKg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const weights = allWeights(d);
  const trend = weightTrendTarget(d, todayISO());
  const rounds = d.sessions.filter((s) => s.type === 'C').map((s) => s.rounds ?? 0);

  const addWeight = () => {
    const v = parseFloat(kg);
    if (!v || v < 30 || v > 250) return store.say('Enter a weight in kg');
    store.update((s) => ({ ...s, weights: [...s.weights, { date: todayISO(), kg: v }] }));
    setKg('');
    store.say('Weight logged');
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `training-log-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    store.say('Backup downloaded');
  };

  const importBackup = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (!parsed.ladders || !parsed.sessions) throw new Error('not a backup');
        // Run it through migrate: a backup taken before the Health work would
        // otherwise restore without the fields the app now reads.
        store.replace(migrate(parsed));
        store.say('Backup restored');
      } catch {
        store.say("That file isn't a backup");
      }
    };
    r.readAsText(file);
  };

  return (
    <section className="view on">
      <h2>The numbers</h2>
      <div className="stats">
        <div className="stat">
          <b>{d.sessions.length}</b>
          <span>Sessions done</span>
        </div>
        <div className="stat">
          <b>{thisWeekCount(d)}</b>
          <span>This week</span>
        </div>
        <div className="stat">
          <b>{bestPull(d)}</b>
          <span>Best pull-ups</span>
        </div>
        <div className="stat">
          <b>{bestRounds(d)}</b>
          <span>Best circuit</span>
        </div>
      </div>

      <h2>Badges</h2>
      <div className="badges">
        {BADGES.map((b) => (
          <div className={`badge${d.seen.includes(b.id) ? ' got' : ''}`} key={b.id}>
            <b>{b.n}</b>
            <span>{b.d}</span>
          </div>
        ))}
      </div>

      <h2>Circuit rounds</h2>
      <Bars values={rounds} />

      <h2>Bodyweight</h2>
      <div className="wrow">
        <input
          type="number"
          step="0.1"
          inputMode="decimal"
          placeholder="71.4 kg"
          value={kg}
          onChange={(e) => setKg(e.target.value)}
        />
        <button className="act" style={{ width: 'auto', padding: '12px 20px' }} onClick={addWeight}>
          Add
        </button>
      </div>
      <Bars values={weights.map((w) => w.kg)} />
      <p className="note">
        {trend.status === 'nodata'
          ? trend.note
          : `${trend.display} over the last 28 days — target ${trend.band}. ${trend.note}`}
      </p>

      <h2>Recent sessions</h2>
      <ul className="log">
        {d.sessions.length ? (
          [...d.sessions]
            .slice(-14)
            .reverse()
            .map((s, i) => (
              <li key={`${s.date}-${i}`}>
                <span>{s.date}</span>
                <b>{s.type === 'C' ? `${s.rounds} rounds` : s.type === 'D' ? 'Core' : `Session ${s.type}`}</b>
              </li>
            ))
        ) : (
          <li>
            <span>No sessions yet. Go do one.</span>
          </li>
        )}
      </ul>

      <h2>Backup</h2>
      <div className="wrow">
        <button className="ghost" onClick={exportBackup}>
          Export backup
        </button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          Import backup
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importBackup(f);
          e.target.value = '';
        }}
      />
      <p className="note">
        Your data lives on this device only. Clearing the browser's site data deletes it, so export a
        backup now and then — the file drops into Files, where iCloud keeps it.
      </p>
    </section>
  );
}
