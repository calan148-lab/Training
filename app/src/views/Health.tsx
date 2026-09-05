import { useEffect, useMemo, useRef, useState } from 'react';
import { Bars } from '../components/Bars';
import { statusClass, statusLabel } from '../components/StatusStrip';
import {
  DEFAULT_SHORTCUT_NAME,
  buildSyncUrl,
  cleanUrl,
  isStandalone,
  markSyncPending,
  readHandoff,
  returnUrl,
  takeSyncPending,
} from '../health/handoff';
import {
  diffHealthDays,
  mergeHealthDays,
  parseShortcutFiles,
  parseShortcutPayload,
} from '../health/shortcut';
import type { ExportWorkerResponse } from '../health/exportWorker';
import { todayISO } from '../domain/types';
import { evaluateTargets, type TargetResult } from '../targets/engine';
import type { Store } from '../useAppData';

function TargetCard({ t }: { t: TargetResult }) {
  return (
    <div className={`target ${statusClass(t.status)}`}>
      <div className="target-top">
        <span className="target-name">{t.name}</span>
        <span className={`chip ${statusClass(t.status)}`}>{statusLabel(t.status)}</span>
      </div>
      <div className="target-val">
        <b>{t.display ?? '—'}</b>
        <span>target {t.band}</span>
      </div>
      {t.series.length > 1 && <Bars values={t.series} />}
      <p className="target-note">{t.note}</p>
    </div>
  );
}

export function Health({ store }: { store: Store }) {
  const d = store.data!;
  const [paste, setPaste] = useState('');
  const [progress, setProgress] = useState<{ pct: number; records: number } | null>(null);
  /** True when a handoff came back empty and the file is the way to finish the sync. */
  const [needsFile, setNeedsFile] = useState(false);
  const jsonRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);
  const handled = useRef(false);

  const verdict = useMemo(() => evaluateTargets(d, todayISO()), [d]);
  const dayCount = Object.keys(d.health.days).length;
  const shortcutName = d.settings.shortcutName?.trim() || DEFAULT_SHORTCUT_NAME;
  const standalone = useMemo(() => isStandalone(), []);

  /**
   * Report what actually landed.
   *
   * The Shortcut emits a trailing window, so most imports are mostly days you
   * already have. Leading with the new count keeps that legible — "2 updated"
   * alone reads like something changed when nothing did.
   */
  const report = (days: Array<{ d: string }>, errors: string[] = []) => {
    const { added, updated } = diffHealthDays(d, days);
    const summary = added
      ? `Imported ${added} new day${added === 1 ? '' : 's'}${updated ? `, ${updated} refreshed` : ''}`
      : `Already up to date — ${updated} day${updated === 1 ? '' : 's'} rechecked`;
    store.say(errors.length ? `${summary} · ${errors.length} file skipped` : summary);
  };

  const importShortcut = (text: string) => {
    try {
      const payload = parseShortcutPayload(text);
      report(payload.days);
      store.update((s) => mergeHealthDays(s, payload.days, 'shortcut'));
      setPaste('');
      setNeedsFile(false);
    } catch (e) {
      store.say(e instanceof Error ? e.message : 'Import failed');
    }
  };

  /** Pick one file or a folder's worth; later files win on conflict. */
  const importFiles = async (files: File[]) => {
    const texts = await Promise.all(files.map((f) => f.text()));
    const { days, errors } = parseShortcutFiles(texts);
    if (!days.length) {
      store.say(errors[0] ?? 'Nothing usable in those files');
      return;
    }
    report(days, errors);
    store.update((s) => mergeHealthDays(s, days, 'shortcut'));
    setNeedsFile(false);
  };

  /**
   * Take delivery of a sync we started.
   *
   * iOS brings us back on a fresh page load, so this runs once on mount and
   * the handoff is scrubbed from the URL immediately — a reload, or the phone
   * restoring this tab next week, must not replay a stale week as a new sync.
   *
   * A return carrying nothing is not a failure: some iOS versions don't hand a
   * shortcut's output back to the page that launched it. The file the Shortcut
   * wrote is still current, so that case falls through to the Files route
   * rather than reporting an error nobody can act on.
   */
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const inbound = readHandoff(window.location.href);
    const wasPending = takeSyncPending();
    if (inbound) window.history.replaceState(null, '', cleanUrl(window.location.href));
    if (inbound?.kind === 'payload') {
      importShortcut(inbound.text);
    } else if (inbound?.kind === 'error') {
      store.say(`Shortcut: ${inbound.message}`);
      setNeedsFile(true);
    } else if (wasPending) {
      setNeedsFile(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Hand off to the Shortcuts app.
   *
   * Two shapes, because the return trip differs by how the app was opened. In
   * a browser tab we name a callback URL and the week comes back on it. In the
   * home-screen app we deliberately don't: iOS would open that URL in Safari,
   * which keeps its own separate copy of this app's storage, so the payload
   * would land somewhere invisible. There we run the Shortcut bare, iOS returns
   * us here when it finishes, and the file it wrote finishes the job.
   *
   * Nothing can tell us whether the scheme was claimed at all — a browser that
   * has never heard of `shortcuts://` does nothing and reports no error. So arm
   * a timer, and if we are still visibly sitting here two seconds later, say why
   * rather than leaving a button that merely looks broken.
   */
  const runShortcut = () => {
    const standalone = isStandalone();
    markSyncPending();

    const bail = window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        takeSyncPending();
        store.say(`Couldn't open Shortcuts — that needs an iPhone, iPad or Mac`);
      }
    }, 2000);

    /** Coming back into the home-screen app, where no page load announces the return. */
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(bail);
      document.removeEventListener('visibilitychange', onReturn);
      if (takeSyncPending()) {
        setNeedsFile(true);
        store.say('Shortcut finished — pick the file it wrote');
      }
    };
    if (standalone) document.addEventListener('visibilitychange', onReturn);
    else document.addEventListener('visibilitychange', () => window.clearTimeout(bail), { once: true });
    window.addEventListener('pagehide', () => window.clearTimeout(bail), { once: true });

    try {
      window.location.href = buildSyncUrl(shortcutName, standalone ? null : returnUrl(window.location));
    } catch {
      window.clearTimeout(bail);
      document.removeEventListener('visibilitychange', onReturn);
      takeSyncPending();
      store.say(`Couldn't open Shortcuts — that needs an iPhone, iPad or Mac`);
    }
  };

  const importExport = (file: File) => {
    if (file.name.endsWith('.zip')) {
      store.say('Uncompress the zip first, then pick export.xml');
      return;
    }
    setProgress({ pct: 0, records: 0 });
    const worker = new Worker(new URL('../health/exportWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress({
          pct: Math.round((msg.progress.bytesRead / Math.max(1, msg.progress.totalBytes)) * 100),
          records: msg.progress.records,
        });
      } else if (msg.type === 'done') {
        store.update((s) => mergeHealthDays(s, msg.days, 'export'));
        store.say(`Imported ${msg.days.length} days from ${msg.records.toLocaleString()} records`);
        setProgress(null);
        worker.terminate();
      } else {
        store.say(`Import failed: ${msg.message}`);
        setProgress(null);
        worker.terminate();
      }
    };
    worker.postMessage({ file });
  };

  return (
    <section className="view on">
      <h2>Are you in target?</h2>
      {verdict.judgeable ? (
        <div className={`verdict ${verdict.inCount === verdict.judgeable ? 'good' : 'bad'}`}>
          <b>
            {verdict.inCount} of {verdict.judgeable} in range
          </b>
          <p>{verdict.headline ?? 'Everything measurable is where it should be.'}</p>
        </div>
      ) : (
        <div className="verdict dim">
          <b>Nothing to judge yet</b>
          <p>Import your Apple Health data below and the targets fill in.</p>
        </div>
      )}

      {verdict.results.map((t) => (
        <TargetCard key={t.id} t={t} />
      ))}

      <h2>Sync Apple Health</h2>
      <p className="note" style={{ margin: '0 0 14px' }}>
        {dayCount
          ? `${dayCount} days stored${d.health.lastSync ? `, last synced ${new Date(d.health.lastSync).toLocaleString()}` : ''}.`
          : 'No Health data yet.'}{' '}
        A browser can't read Apple Health directly, so the data has to be handed over — either route below works.
      </p>

      <h3 className="sub">Daily — the Shortcut</h3>
      <button className="act" onClick={runShortcut}>
        ⚡ Sync now
      </button>
      <p className="note">
        One tap runs your <b>{shortcutName}</b> Shortcut — the same one the morning automation runs,
        so nothing about that changes.{' '}
        {standalone
          ? `Added to the home screen, iOS can't hand the result back to this app — it would open Safari, which keeps its own separate storage — so it brings you back here and you finish with the file below.`
          : `iOS hands the week it read straight back to this page, so there is no file to pick.`}{' '}
        Build the Shortcut once; the recipe is in <code>HEALTH-SYNC.md</code>. Nothing leaves the
        phone either way.
      </p>

      {needsFile && (
        <div className="warnbox" style={{ marginTop: 12 }}>
          <b>The Shortcut ran, but sent nothing back.</b>
          <p className="note" style={{ margin: '6px 0 0' }}>
            Not every iOS version returns a shortcut's output to the page that launched it. The file
            it wrote to iCloud Drive is current either way — pick it below. To make the round trip
            automatic, end the Shortcut with an <b>Open URL</b> action; <code>HEALTH-SYNC.md</code>{' '}
            has the URL to use.
          </p>
        </div>
      )}

      <div className="wrow" style={{ marginTop: 12 }}>
        <button className="ghost" onClick={() => jsonRef.current?.click()}>
          📂 Import from Files
        </button>
      </div>
      <input
        ref={jsonRef}
        type="file"
        accept="application/json,.json"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) void importFiles(files);
          e.target.value = '';
        }}
      />
      <p className="note">
        The Shortcut also saves its JSON to iCloud Drive, so this route works when the tap-through
        can't — on a desktop browser, or when you've been away and want several files at once.
        Re-importing a day you already have is harmless.
      </p>

      <details className="fold">
        <summary>Shortcut name</summary>
        <p className="note" style={{ margin: '0 0 8px' }}>
          Must match the Shortcut on your phone exactly, including capitals. Renaming it here is the
          only thing needed if you called yours something else.
        </p>
        <input
          className="paste"
          placeholder={DEFAULT_SHORTCUT_NAME}
          aria-label="Shortcut name"
          value={d.settings.shortcutName ?? ''}
          onChange={(e) =>
            store.update((s) => ({
              ...s,
              settings: { ...s.settings, shortcutName: e.target.value.trim() || undefined },
            }))
          }
        />
      </details>

      <details className="fold">
        <summary>Paste instead</summary>
        <textarea
          className="paste"
          placeholder='Paste the Shortcut output here, e.g. {"t":"health8w","v":1,"days":[…]}'
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
        />
        <button
          className="ghost"
          onClick={() => importShortcut(paste)}
          disabled={!paste.trim()}
        >
          Import pasted
        </button>
      </details>

      <h3 className="sub">One-off — full history</h3>
      <p className="note" style={{ margin: '0 0 10px' }}>
        Health app → your photo → Export All Health Data. That gives a zip; uncompress it in Files
        (long-press → Uncompress) and pick <code>export.xml</code>. It can be hundreds of megabytes,
        so it's parsed in the background a chunk at a time.
      </p>
      <button className="ghost" onClick={() => xmlRef.current?.click()} disabled={!!progress}>
        {progress ? `Reading… ${progress.pct}% · ${progress.records.toLocaleString()} records` : 'Pick export.xml'}
      </button>
      <input
        ref={xmlRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importExport(f);
          e.target.value = '';
        }}
      />
      {progress && (
        <div className="xpbar" style={{ marginTop: 10 }}>
          <div style={{ width: `${progress.pct}%` }} />
        </div>
      )}
    </section>
  );
}
