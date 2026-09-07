/**
 * One-tap Health sync: hand control to the iOS Shortcut, then take its answer
 * back off the URL iOS returns us on.
 *
 * The Shortcut in HEALTH-SYNC.md already knows how to read Health and emit a
 * trailing week of JSON — this module is only the two ends of that trip. It
 * saves the round trip through the Files picker, which is otherwise the whole
 * of the daily ritual.
 *
 * Nothing here talks to a network. The payload travels inside a URL on the
 * phone, between two apps on the phone; the data still never leaves it.
 */

/** The Shortcut this app expects, unless you've named yours something else. */
export const DEFAULT_SHORTCUT_NAME = '8 Weeks Health Sync';

/**
 * Where the returning payload can turn up.
 *
 * `result` is what Shortcuts' x-callback-url puts the shortcut's output in.
 * `health` and `payload` are for a Shortcut that ends with an Open URL action
 * instead — a fallback worth keeping, because x-callback's return contract has
 * shifted between iOS releases and a silent empty sync is a miserable failure.
 */
const PAYLOAD_KEYS = ['health', 'payload', 'result'] as const;

/** `errorMessage` is what x-error appends; `healthError` is for a hand-rolled Open URL. */
const ERROR_KEYS = ['errorMessage', 'healthError'] as const;

/** Set while we're away in Shortcuts, so a return with no payload is still recognisable as one. */
const PENDING_KEY = 'health.sync.pending';

export type Handoff = { kind: 'payload'; text: string } | { kind: 'error'; message: string };

/** Query and hash pooled into one bag — a Shortcut may append to either. */
function readParams(url: URL): URLSearchParams {
  const p = new URLSearchParams(url.search);
  const hash = url.hash.replace(/^#\/?/, '');
  if (hash.includes('=')) {
    for (const [k, v] of new URLSearchParams(hash)) p.append(k, v);
  }
  return p;
}

const looksLikeJson = (s: string) => /^[[{]/.test(s);

/** Decode base64 (standard or URL-safe) to text, or null if it isn't base64. */
function fromBase64(s: string): string | null {
  // A `+` inside a query string arrives as a space, so put it back before decoding.
  const norm = s.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(norm);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Recognise a payload, in whichever shape Shortcuts handed it over.
 *
 * Returns null for anything that isn't JSON rather than raising: a bare
 * callback carrying no result, or one echoing a URL, means "the Shortcut ran
 * but told us nothing", which is a different situation from a broken payload
 * and gets a different answer from the app.
 */
export function decodePayloadText(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (looksLikeJson(t)) return t;
  const decoded = fromBase64(t);
  return decoded && looksLikeJson(decoded.trim()) ? decoded.trim() : null;
}

/** What, if anything, the Shortcut sent back on this URL. */
export function readHandoff(href: string): Handoff | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const p = readParams(url);
  for (const k of ERROR_KEYS) {
    const v = p.get(k)?.trim();
    if (v) return { kind: 'error', message: v };
  }
  for (const k of PAYLOAD_KEYS) {
    const v = p.get(k);
    const text = v === null ? null : decodePayloadText(v);
    if (text) return { kind: 'payload', text };
  }
  return null;
}

/**
 * The same URL with the handoff stripped out.
 *
 * Pushed over the current entry so a reload — or the phone restoring the tab a
 * week later — doesn't replay a stale sync as if it were new.
 */
export function cleanUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const keys: string[] = [...PAYLOAD_KEYS, ...ERROR_KEYS];
  for (const k of keys) url.searchParams.delete(k);
  const hash = url.hash.replace(/^#\/?/, '');
  if (hash.includes('=')) {
    const hp = new URLSearchParams(hash);
    for (const k of keys) hp.delete(k);
    const rest = hp.toString();
    url.hash = rest ? `#${rest}` : '';
  }
  return url.toString();
}

/** Where iOS should bring us back to: this page, with no handoff of its own attached. */
export function returnUrl(loc: { origin: string; pathname: string } = window.location): string {
  return `${loc.origin}${loc.pathname}`;
}

/**
 * The URL that runs the Shortcut.
 *
 * x-callback-url is used rather than the plain `run-shortcut` scheme for one
 * reason: it names a URL to come back to on success, failure *and* cancel, so
 * you are never left sitting in the Shortcuts app wondering whether it worked.
 */
export function buildSyncUrl(name: string, back?: string | null): string {
  const n = encodeURIComponent(name.trim());
  if (!back) return `shortcuts://run-shortcut?name=${n}`;
  const b = encodeURIComponent(back);
  return `shortcuts://x-callback-url/run-shortcut?name=${n}&x-success=${b}&x-error=${b}&x-cancel=${b}`;
}

/**
 * Is this the home-screen app rather than a browser tab?
 *
 * It decides whether the round trip can work at all. iOS opens an https
 * callback in Safari, never in an installed web app — and Safari holds its own
 * separate copy of this app's storage, so a payload sent back that way would
 * land somewhere you can't see. Installed, we run the Shortcut without a
 * callback and finish through the file it wrote instead.
 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** Remember that we handed off, so an empty return can still be explained. */
export function markSyncPending(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, String(Date.now()));
  } catch {
    /* private mode — the sync still works, it just can't explain an empty return */
  }
}

/** Default staleness for a pending handoff: long enough for Face ID and a slow Shortcut, short enough not to ambush you tomorrow. */
const PENDING_TTL_MS = 10 * 60 * 1000;

function pendingAge(now: number): number | null {
  try {
    const at = sessionStorage.getItem(PENDING_KEY);
    return at === null ? null : now - Number(at);
  } catch {
    return null;
  }
}

/** Is a handoff outstanding? Peeks — used to decide which tab to open on. */
export function isSyncPending(maxAgeMs = PENDING_TTL_MS, now = Date.now()): boolean {
  const age = pendingAge(now);
  return age !== null && age < maxAgeMs;
}

/** The same question, but consuming the flag so it is answered only once. */
export function takeSyncPending(maxAgeMs = PENDING_TTL_MS, now = Date.now()): boolean {
  const outstanding = isSyncPending(maxAgeMs, now);
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing stored means nothing to clear */
  }
  return outstanding;
}
