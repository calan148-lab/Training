import { useState, type ReactNode } from 'react';
import './styles.css';
import './styles.ipad.css';
import { weekNo } from './domain/progress';
import { useAppData } from './useAppData';
import { Health } from './views/Health';
import { Ladders } from './views/Ladders';
import { Meals } from './views/Meals';
import { Progress } from './views/Progress';
import { Settings } from './views/Settings';
import { Today } from './views/Today';

/**
 * `label` is what fits across the bottom of a phone; `wide` is what the iPad
 * rail shows instead, where there is room for the word the tab actually means.
 * Exactly one of the two is ever rendered — the other is display:none, so it
 * stays out of the accessibility tree rather than being read out twice.
 */
const TABS = [
  { id: 'today', label: 'Today', wide: 'Today' },
  { id: 'ladders', label: 'Ladders', wide: 'Progressions' },
  { id: 'meals', label: 'Food', wide: 'Nutrition' },
  { id: 'health', label: 'Target', wide: 'Targets' },
  { id: 'progress', label: 'Stats', wide: 'Progress' },
  { id: 'settings', label: 'Setup', wide: 'Settings' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/** Line art only, sized in ems and painted in currentColor: the rail tints them. */
const GLYPHS: Record<Tab, ReactNode> = {
  today: (
    <>
      <rect x="3" y="4.75" width="18" height="16" rx="3" />
      <path d="M3 9.75h18M8 2.75v4M16 2.75v4" />
    </>
  ),
  ladders: <path d="M7.5 21V3M16.5 21V3M7.5 17.5h9M7.5 12h9M7.5 6.5h9" />,
  meals: (
    <>
      <path d="M6.5 3v6.5a2.75 2.75 0 0 0 5.5 0V3M9.25 12.25V21" />
      <path d="M18 3c-1.6 1.7-2.4 3.7-2.4 6 0 1.7.8 2.8 2.4 3.2V21" />
    </>
  ),
  health: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.75" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  progress: <path d="M4 20.25h16M7.75 20.25v-5.5M12 20.25V6.5M16.25 20.25v-9" />,
  settings: (
    <>
      <path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h3.5M12.5 16.5H20" />
      <circle cx="15" cy="7.5" r="2.5" />
      <circle cx="10" cy="16.5" r="2.5" />
    </>
  ),
};

export function App() {
  const store = useAppData();
  const [tab, setTab] = useState<Tab>('today');

  if (!store.data) return <div className="wrap boot">Loading…</div>;
  const d = store.data;
  const w = weekNo(d);

  return (
    <div className="app">
      {/*
        Masthead and tabs travel together. On a phone this aside is a plain
        block: the masthead renders in flow and the tab bar stays fixed to the
        bottom. On an iPad the same two children become the left sidebar.
      */}
      <aside className="sidebar">
        <div className="sidebarTop">
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
              <svg
                className="tabIcon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {GLYPHS[t.id]}
              </svg>
              <span className="tabShort">{t.label}</span>
              <span className="tabWide">{t.wide}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="stage">
        <div className="wrap">
          {tab === 'today' && <Today store={store} />}
          {tab === 'ladders' && <Ladders store={store} />}
          {tab === 'meals' && <Meals store={store} />}
          {tab === 'health' && <Health store={store} />}
          {tab === 'progress' && <Progress store={store} />}
          {tab === 'settings' && <Settings store={store} />}
        </div>
      </main>

      {store.toast && <div className="toast show">{store.toast}</div>}
    </div>
  );
}
