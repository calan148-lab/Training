import { useState } from 'react';
import './styles.css';
import { weekNo } from './domain/progress';
import { useAppData } from './useAppData';
import { Health } from './views/Health';
import { Ladders } from './views/Ladders';
import { Meals } from './views/Meals';
import { Progress } from './views/Progress';
import { Settings } from './views/Settings';
import { Today } from './views/Today';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'ladders', label: 'Ladders' },
  { id: 'meals', label: 'Food' },
  { id: 'health', label: 'Target' },
  { id: 'progress', label: 'Stats' },
  { id: 'settings', label: 'Setup' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function App() {
  const store = useAppData();
  const [tab, setTab] = useState<Tab>('today');

  if (!store.data) return <div className="wrap boot">Loading…</div>;
  const d = store.data;
  const w = weekNo(d);

  return (
    <>
      <div className="wrap">
        <header>
          <p className="kicker">Calisthenics · Week {w} of 8</p>
          <h1>
            Training
            <br />
            Log
          </h1>
          <div className="weekbar">
            {[...Array(8)].map((_, i) => (
              <i key={i} className={i + 1 < w ? 'on' : i + 1 === w ? 'now' : ''} />
            ))}
          </div>
          <div className="weekmeta">
            <span>
              {d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}
            </span>
            <span>{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </div>
        </header>

        {tab === 'today' && <Today store={store} />}
        {tab === 'ladders' && <Ladders store={store} />}
        {tab === 'meals' && <Meals store={store} />}
        {tab === 'health' && <Health store={store} />}
        {tab === 'progress' && <Progress store={store} />}
        {tab === 'settings' && <Settings store={store} />}
      </div>

      <nav>
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              setTab(t.id);
              window.scrollTo(0, 0);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {store.toast && <div className="toast show">{store.toast}</div>}
    </>
  );
}
