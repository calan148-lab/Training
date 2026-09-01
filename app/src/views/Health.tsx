import { useMemo, useRef, useState } from 'react';
import { Bars } from '../components/Bars';
import { statusClass, statusLabel } from '../components/StatusStrip';
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
  const jsonRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  const verdict = useMemo(() => evaluateTargets(d, todayISO()), [d]);
  const dayCount = Object.keys(d.health.days).length;

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
      <button className="act" onClick={() => jsonRef.current?.click()}>
        📂 Import from Files
      </button>
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
        Build the Shortcut once — the recipe is in <code>HEALTH-SYNC.md</code>. It saves a JSON file
        to iCloud Drive on a schedule; pick it here and you're done. Nothing leaves your phone. You
        can select several files at once if you've been away, and re-importing a day you already have
        is harmless.
      </p>

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
