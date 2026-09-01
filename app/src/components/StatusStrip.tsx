import type { TargetResult, Verdict } from '../targets/engine';

export function statusClass(s: TargetResult['status']): string {
  switch (s) {
    case 'in':
      return 'good';
    case 'low':
    case 'high':
      return 'bad';
    case 'info':
      return 'warn';
    default:
      return 'dim';
  }
}

export function statusLabel(s: TargetResult['status']): string {
  switch (s) {
    case 'in':
      return 'In target';
    case 'low':
      return 'Under';
    case 'high':
      return 'Over';
    case 'info':
      return 'Context';
    default:
      return 'No data';
  }
}

/**
 * The one-line answer, on the Today view so it needs no navigation.
 * Deliberately shows the single most important action rather than a list —
 * a wall of amber tells you nothing about what to do next.
 */
export function StatusStrip({ verdict }: { verdict: Verdict }) {
  if (!verdict.judgeable) {
    return (
      <div className="strip dim">
        <b>No targets yet</b>
        <span>Import Apple Health data to see where you stand.</span>
      </div>
    );
  }
  const allGood = verdict.inCount === verdict.judgeable;
  return (
    <div className={`strip ${allGood ? 'good' : 'bad'}`}>
      <b>
        {verdict.inCount} of {verdict.judgeable} targets in range
      </b>
      <span>{verdict.headline ?? 'Everything measurable is where it should be.'}</span>
    </div>
  );
}
