import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

const env: Env = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  APP_TOKEN: 'correct-horse-battery-staple',
  ALLOWED_ORIGIN: 'https://example.github.io',
};

const IMAGE = btoa('not really a jpeg but the worker only checks size');

function post(body: unknown, token = env.APP_TOKEN): Request {
  return new Request('https://w.dev/meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const goodBody = { image: IMAGE, mediaType: 'image/jpeg' };

/** A well-formed Anthropic response, thinking block first. */
function upstreamOk(payload: unknown, usage = { input_tokens: 1500, output_tokens: 400 }) {
  return new Response(
    JSON.stringify({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: JSON.stringify(payload) },
      ],
      usage,
    }),
    { status: 200 },
  );
}

const ESTIMATE = {
  items: [
    { name: 'rice', portionEstimate: 'one bowl', grams: 200, kcal: 260, protein_g: 5.4, carbs_g: 57, fat_g: 0.6, confidence: 0.7 },
  ],
  total: { kcal: 260, protein_g: 5.4, carbs_g: 57, fat_g: 0.6 },
  assumptions: ['No oil visible, none assumed'],
};

afterEach(() => vi.unstubAllGlobals());

describe('auth', () => {
  it('rejects a missing token before spending anything', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(
      new Request('https://w.dev/meal', { method: 'POST', body: '{}' }),
      env,
    );
    expect(res.status).toBe(401);
    // The point of checking auth first: no upstream call was made.
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a wrong token', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(post(goodBody, 'guess'), env);
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a token that is a prefix of the real one', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await worker.fetch(post(goodBody, 'correct-horse'), env)).status).toBe(401);
  });

  it('fails closed when the Worker itself is misconfigured', async () => {
    const res = await worker.fetch(post(goodBody), { ...env, APP_TOKEN: '' });
    expect(res.status).toBe(500);
  });
});

describe('validation', () => {
  it('rejects a missing image', async () => {
    const res = await worker.fetch(post({ mediaType: 'image/jpeg' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported media type', async () => {
    const res = await worker.fetch(post({ image: IMAGE, mediaType: 'image/gif' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects an oversized image rather than paying for it', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const huge = 'A'.repeat(8 * 1024 * 1024);
    const res = await worker.fetch(post({ image: huge, mediaType: 'image/jpeg' }), env);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body', async () => {
    const res = await worker.fetch(
      new Request('https://w.dev/meal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.APP_TOKEN}` },
        body: 'not json',
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('request it builds', () => {
  it('sends the image, the schema and low effort', async () => {
    let sent: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return upstreamOk(ESTIMATE);
    });
    await worker.fetch(post({ ...goodBody, hint: 'cooked in butter' }), env);

    expect(sent.model).toBe('claude-opus-5');
    expect(sent.output_config.effort).toBe('low');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.output_config.format.schema.required).toContain('items');
    // Strictness needs additionalProperties:false as well as required.
    expect(sent.output_config.format.schema.additionalProperties).toBe(false);

    const [img, text] = sent.messages[0].content;
    expect(img.type).toBe('image');
    expect(img.source.media_type).toBe('image/jpeg');
    expect(text.text).toContain('cooked in butter');
  });

  it('honours a model override', async () => {
    let sent: any;
    vi.stubGlobal('fetch', async (_u: string, i: RequestInit) => {
      sent = JSON.parse(i.body as string);
      return upstreamOk(ESTIMATE);
    });
    await worker.fetch(post({ ...goodBody, model: 'claude-haiku-4-5' }), env);
    expect(sent.model).toBe('claude-haiku-4-5');
  });

  it('truncates an over-long hint', async () => {
    let sent: any;
    vi.stubGlobal('fetch', async (_u: string, i: RequestInit) => {
      sent = JSON.parse(i.body as string);
      return upstreamOk(ESTIMATE);
    });
    await worker.fetch(post({ ...goodBody, hint: 'x'.repeat(5000) }), env);
    expect(sent.messages[0].content[1].text.length).toBeLessThan(600);
  });

  it('sends the key as a header and never in the body', async () => {
    let headers: any;
    let body = '';
    vi.stubGlobal('fetch', async (_u: string, i: RequestInit) => {
      headers = i.headers;
      body = i.body as string;
      return upstreamOk(ESTIMATE);
    });
    await worker.fetch(post(goodBody), env);
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body).not.toContain('sk-ant-test');
  });
});

describe('response handling', () => {
  it('returns the parsed estimate with usage attached', async () => {
    vi.stubGlobal('fetch', async () => upstreamOk(ESTIMATE));
    const res = await worker.fetch(post(goodBody), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.items[0].name).toBe('rice');
    expect(body.total.kcal).toBe(260);
    expect(body.usage.input_tokens).toBe(1500);
  });

  it('finds the text block even when thinking comes first', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: 'weighing the bowl' },
            { type: 'text', text: JSON.stringify(ESTIMATE) },
          ],
        }),
        { status: 200 },
      ),
    );
    const body = (await (await worker.fetch(post(goodBody), env)).json()) as any;
    expect(body.total.kcal).toBe(260);
  });

  it('passes an upstream status through so the client can tell retryable apart', async () => {
    vi.stubGlobal('fetch', async () => new Response('rate limited', { status: 429 }));
    expect((await worker.fetch(post(goodBody), env)).status).toBe(429);

    vi.stubGlobal('fetch', async () => new Response('bad key', { status: 401 }));
    expect((await worker.fetch(post(goodBody), env)).status).toBe(401);
  });

  it('reports a refusal distinctly', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 }),
    );
    const res = await worker.fetch(post(goodBody), env);
    expect(res.status).toBe(422);
  });

  it('reports unparseable model output rather than passing prose on', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'I think that is pasta.' }] }), { status: 200 }),
    );
    const res = await worker.fetch(post(goodBody), env);
    expect(res.status).toBe(502);
  });

  it('reports a network failure as a gateway error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection reset');
    });
    expect((await worker.fetch(post(goodBody), env)).status).toBe(502);
  });
});

describe('rate limiting', () => {
  it('refuses when the limiter says so, before calling the API', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await worker.fetch(post(goodBody), {
      ...env,
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    });
    expect(res.status).toBe(429);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('CORS and routing', () => {
  it('answers preflight with the configured origin', async () => {
    const res = await worker.fetch(new Request('https://w.dev/meal', { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io');
  });

  it('has a health check that needs no auth', async () => {
    const res = await worker.fetch(new Request('https://w.dev/health'), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).model).toBe('claude-opus-5');
  });

  it('404s anything else', async () => {
    expect((await worker.fetch(new Request('https://w.dev/other'), env)).status).toBe(404);
  });
});
