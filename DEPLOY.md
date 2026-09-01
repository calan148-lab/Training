# Deploying

Two pieces. The app is static and goes on GitHub Pages; the vision proxy is a Cloudflare
Worker. Both are free at the volume one person generates — the only running cost is the
Anthropic API, at roughly **£1.30–2 a month** for three photos a day.

You only need the Worker if you want photo calorie logging. Everything else — training,
ladders, Apple Health import, and every target except intake — works on the static site
alone.

---

## 1. The app → GitHub Pages

Already wired up. `.github/workflows/deploy.yml` builds on every push to the default
branch and publishes `app/dist`.

One-time setup: **repo Settings → Pages → Source → GitHub Actions**.

The site then serves from `https://<user>.github.io/<repo>/`. Open that on the phone and
use *Share → Add to Home Screen* to install it as a standalone app.

Assets are built with a relative base, so the same build works at a repo subpath or at a
custom domain root with no reconfiguration.

---

## 2. The vision proxy → Cloudflare Worker

### Why this exists

An API key in client-side JavaScript is readable by anyone who opens the page. There is no
way around that — not obfuscation, not a build step. The key has to live somewhere the
browser can't see, which means a server. This one is about 150 lines and does nothing but
check a token, forward one image, and hand back typed JSON.

### Deploy it

```bash
npm install -g wrangler          # if you don't have it
cd worker
wrangler login

# Secrets. These never touch the repo.
wrangler secret put ANTHROPIC_API_KEY     # from console.anthropic.com
wrangler secret put APP_TOKEN             # invent a long random string, e.g.
                                          # openssl rand -base64 32

wrangler deploy
```

Deploy prints your Worker's URL. Then lock it to your site — edit `wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://<user>.github.io"
```

and `wrangler deploy` again.

### Point the app at it

In the app: **Setup** → paste the Worker URL and the `APP_TOKEN` you invented. Both are
stored on that device only and never go near the repo.

### Check it

```bash
curl https://<your-worker>.workers.dev/health
# {"ok":true,"model":"claude-opus-5"}
```

That endpoint needs no auth. `/meal` returns `401` without the bearer token.

---

## Keeping it from costing you money

The Worker's URL will be visible in the app's JavaScript — that is unavoidable for a
static site. Three layers stop that mattering, in increasing order of how much you should
trust them:

1. **The bearer token.** Someone who finds the URL still can't call it. This is what
   actually protects you day to day.
2. **Rate limiting.** `wrangler.toml` caps requests per minute per IP. A speed bump.
3. **A spend limit in the Anthropic Console.** Set one. It is the only measure that holds
   if the token ever leaks, and it costs nothing to configure.

---

## What a photo costs

Photos are downscaled to 1024px before upload, which puts them at roughly 1,050 image
tokens. With the prompt and schema that is about 1,500 tokens in, and the estimate comes
back in around 400.

| Model | Per photo | 3/day | 5/day |
|---|---|---|---|
| **claude-opus-5** (default) | ~1.8p | ~£1.60/mo | ~£2.60/mo |
| claude-sonnet-5 | ~0.7p | ~£0.65/mo | ~£1.05/mo |
| claude-haiku-4-5 | ~0.35p | ~£0.32/mo | ~£0.55/mo |

**These are calculated, not measured** — this repo has never been run against the live API
(see *Not yet verified* in the README). The figure to watch is thinking tokens, which bill
as output. The Worker sends `effort: "low"` precisely to keep them down, but the first
real photo is the one that tells you the truth. Every response echoes its `usage`, so
check it once and adjust expectations.

Prompt caching would not help here: the system prompt is a few hundred tokens, well under
the minimum cacheable prefix.

Switch models in **Setup**. Haiku is roughly a fifth the cost and noticeably weaker at
judging portions, which is the part that matters most.

---

## Running locally

```bash
npm install
npm run dev            # the app, on :5173
npm run dev -w worker  # the Worker, on :8787
```

For the local Worker, put the secrets in `worker/.dev.vars` (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
APP_TOKEN=anything-for-local
```

Then set the app's Setup tab to `http://localhost:8787`.

```bash
npm test               # app tests
npm test -w worker     # worker tests
node e2e/run.mjs       # full browser run against the built app
```
