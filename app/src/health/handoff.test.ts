import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_NAME,
  buildSyncUrl,
  cleanUrl,
  decodePayloadText,
  readHandoff,
  returnUrl,
} from './handoff';

const APP = 'https://me.github.io/Training/';
const payload = '{"t":"health8w","v":1,"days":[{"d":"2026-08-31","wt":71.4}]}';
const b64 = (s: string) => btoa(s);

describe('buildSyncUrl', () => {
  it('names the Shortcut and every way back', () => {
    const url = buildSyncUrl(DEFAULT_SHORTCUT_NAME, APP);
    expect(url.startsWith('shortcuts://x-callback-url/run-shortcut?')).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(q.get('name')).toBe(DEFAULT_SHORTCUT_NAME);
    // Cancel and error have to come home too, or a failed sync strands you in Shortcuts.
    expect(q.get('x-success')).toBe(APP);
    expect(q.get('x-error')).toBe(APP);
    expect(q.get('x-cancel')).toBe(APP);
  });

  it('escapes a name with spaces and punctuation', () => {
    const url = buildSyncUrl('Health & Fitness / daily', APP);
    expect(url).toContain('name=Health%20%26%20Fitness%20%2F%20daily');
  });

  it('falls back to the plain scheme when there is nowhere to return to', () => {
    expect(buildSyncUrl('Sync', null)).toBe('shortcuts://run-shortcut?name=Sync');
  });
});

describe('returnUrl', () => {
  it('drops any query and hash, so we never nest one handoff inside the next', () => {
    expect(returnUrl({ origin: 'https://me.github.io', pathname: '/Training/' })).toBe(APP);
  });
});

describe('readHandoff', () => {
  it('reads the result Shortcuts appends to x-success', () => {
    const href = `${APP}?result=${encodeURIComponent(payload)}`;
    expect(readHandoff(href)).toEqual({ kind: 'payload', text: payload });
  });

  it('reads a payload an Open URL action put in the hash', () => {
    const href = `${APP}#health=${encodeURIComponent(payload)}`;
    expect(readHandoff(href)).toEqual({ kind: 'payload', text: payload });
  });

  it('accepts base64, standard or URL-safe', () => {
    for (const encoded of [b64(payload), b64(payload).replace(/\+/g, '-').replace(/\//g, '_')]) {
      const got = readHandoff(`${APP}?health=${encodeURIComponent(encoded)}`);
      expect(got).toEqual({ kind: 'payload', text: payload });
    }
  });

  it('survives a base64 payload whose + arrived as a space', () => {
    // Unencoded query strings turn + into space; base64 uses + as a digit.
    const encoded = b64('{"days":[{"d":"2026-08-31","wt":71.4}]}?~');
    if (encoded.includes('+')) {
      const got = readHandoff(`${APP}?health=${encoded.replace(/\+/g, ' ')}`);
      expect(got?.kind).toBe('payload');
    }
  });

  it('surfaces the message x-error brings back', () => {
    const href = `${APP}?errorMessage=${encodeURIComponent('Shortcut not found')}`;
    expect(readHandoff(href)).toEqual({ kind: 'error', message: 'Shortcut not found' });
  });

  it('is null for a plain visit', () => {
    expect(readHandoff(APP)).toBeNull();
    expect(readHandoff(`${APP}#food`)).toBeNull();
  });

  it('is null when the callback carries something that is not a payload', () => {
    // A shortcut ending in Open URL reports that URL as its result; the empty
    // callback that follows must read as "nothing came back", not as a broken
    // payload the user has to go and fix.
    expect(readHandoff(`${APP}?result=${encodeURIComponent(APP)}`)).toBeNull();
    expect(readHandoff(`${APP}?result=`)).toBeNull();
  });

  it('is null for an unparseable href rather than throwing', () => {
    expect(readHandoff('not a url')).toBeNull();
  });
});

describe('decodePayloadText', () => {
  it('passes JSON through untouched', () => {
    expect(decodePayloadText(` ${payload} `)).toBe(payload);
  });

  it('refuses text that decodes to something that is not JSON', () => {
    expect(decodePayloadText('hello there')).toBeNull();
  });
});

describe('cleanUrl', () => {
  it('strips the handoff from the query, keeping anything else', () => {
    expect(cleanUrl(`${APP}?tab=health&result=${encodeURIComponent(payload)}`)).toBe(`${APP}?tab=health`);
  });

  it('strips it from the hash and leaves no bare #', () => {
    expect(cleanUrl(`${APP}#health=${encodeURIComponent(payload)}`)).toBe(APP);
  });

  it('leaves a URL with no handoff alone', () => {
    expect(cleanUrl(APP)).toBe(APP);
  });
});
