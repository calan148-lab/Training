import { MEAL_SCHEMA, SUPPLEMENT_PROMPT, SUPPLEMENT_SCHEMA, SYSTEM_PROMPT } from './schema';

export interface Env {
  /** Anthropic API key. Set with `wrangler secret put ANTHROPIC_API_KEY` — never in wrangler.toml. */
  ANTHROPIC_API_KEY: string;
  /** Shared token the app sends as a bearer. `wrangler secret put APP_TOKEN`. */
  APP_TOKEN: string;
  /** Exact origin allowed to call this Worker, e.g. https://calan148-lab.github.io */
  ALLOWED_ORIGIN?: string;
  /** Optional Cloudflare rate-limiting binding. */
  RATE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-5';
/** Downscaled photos land well under this; anything larger is a client bug. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface MealRequest {
  image: string;
  mediaType: string;
  hint?: string;
  model?: string;
}

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env) },
  });
}

/** Constant-time-ish comparison, so a token can't be recovered by timing. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * One upstream call, two jobs. Auth, rate limiting, size checks and error
 * classification are identical whichever panel is in the photo, so only the
 * schema, the system prompt and the ask differ per route.
 */
const ROUTES: Record<string, { schema: unknown; system: string; ask: string }> = {
  '/meal': { schema: MEAL_SCHEMA, system: SYSTEM_PROMPT, ask: 'Estimate this meal.' },
  '/supplement': {
    schema: SUPPLEMENT_SCHEMA,
    system: SUPPLEMENT_PROMPT,
    ask: 'Read this supplement label.',
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, model: DEFAULT_MODEL }, 200, env);
    }
    const route = request.method === 'POST' ? ROUTES[url.pathname] : undefined;
    if (!route) {
      return json({ error: 'Not found' }, 404, env);
    }

    // Auth before anything expensive: this endpoint spends real money, and its
    // URL is visible in the client bundle.
    if (!env.APP_TOKEN || !env.ANTHROPIC_API_KEY) {
      return json({ error: 'Worker is missing APP_TOKEN or ANTHROPIC_API_KEY.' }, 500, env);
    }
    const auth = request.headers.get('Authorization') ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokensMatch(presented, env.APP_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401, env);
    }

    if (env.RATE_LIMITER) {
      const key = request.headers.get('CF-Connecting-IP') ?? 'anon';
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) return json({ error: 'Slow down a moment and try again.' }, 429, env);
    }

    let body: MealRequest;
    try {
      body = (await request.json()) as MealRequest;
    } catch {
      return json({ error: 'Body must be JSON.' }, 400, env);
    }
    if (typeof body.image !== 'string' || !body.image) {
      return json({ error: 'Missing "image" (base64, no data: prefix).' }, 400, env);
    }
    if (!ALLOWED_MEDIA.has(body.mediaType)) {
      return json({ error: `Unsupported mediaType "${body.mediaType}".` }, 400, env);
    }
    // base64 inflates by 4/3; check the decoded size.
    if ((body.image.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return json({ error: 'Image too large — downscale before sending.' }, 413, env);
    }

    const hint = typeof body.hint === 'string' ? body.hint.slice(0, 500) : '';
    const userText = hint ? `${route.ask} Context from the owner: ${hint}` : route.ask;

    const payload = {
      model: body.model || DEFAULT_MODEL,
      max_tokens: 4096,
      system: route.system,
      // Low effort: identifying food and judging a portion against a visual
      // reference is a bounded perception task, not deep reasoning. Thinking
      // tokens bill as output, so leaving this at the default would multiply
      // the per-photo cost for no gain in accuracy.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: route.schema },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.image } },
            { type: 'text', text: userText },
          ],
        },
      ],
    };

    let upstream: Response;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: `Could not reach the API: ${(e as Error).message}` }, 502, env);
    }

    if (!upstream.ok) {
      const detail = await upstream.text();
      // Pass the status through so the client can tell "retry later" (429/5xx)
      // from "this will never work" (400/401).
      return json({ error: `API error ${upstream.status}`, detail: detail.slice(0, 500) }, upstream.status, env);
    }

    const result = (await upstream.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: Record<string, number>;
      stop_reason?: string;
    };

    if (result.stop_reason === 'refusal') {
      return json({ error: 'The model declined to analyse that image.' }, 422, env);
    }

    // With thinking on, the response can lead with thinking blocks — take the
    // first text block rather than assuming content[0].
    const text = result.content?.find((b) => b.type === 'text')?.text;
    if (!text) {
      return json({ error: 'No text block in the response.' }, 502, env);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: 'Model returned unparseable JSON.', detail: text.slice(0, 500) }, 502, env);
    }

    // Usage is echoed so the app can show what a photo actually costs.
    return json({ ...(parsed as object), usage: result.usage }, 200, env);
  },
};
