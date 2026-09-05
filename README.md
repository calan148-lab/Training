# 8 Weeks — Training Log

An 8-week calisthenics log that answers one question: **am I in target, or out of target?**

It tracks sessions, progression ladders and bodyweight, pulls in Apple Health, estimates
calories from meal photos, and judges all of it against explicit targets on rolling
windows — so "am I gaining?" has an answer instead of a bar chart to squint at.

Installs to the home screen as a PWA. Data lives on your phone.

```
app/     Vite + React + TypeScript, IndexedDB   → GitHub Pages
worker/  Cloudflare Worker holding the API key  → vision proxy only
e2e/     Browser run against the real build
```

---

## The targets

Every one is judged on a rolling window, never a single reading. A target with too little
data says so rather than guessing.

| Target | Window | In range |
|---|---|---|
| **Weight trend** | 28-day least-squares slope | +0.25 to +0.5 kg/mo (lean gain) |
| **Training frequency** | 7 days | ≥ 4 full sessions |
| **Protein** | 7-day mean | 1.6–2.2 g/kg bodyweight |
| **Recovery** | 7-day mean vs 28-day baseline | resting HR ≤ +5%, HRV ≥ −10% |
| **Sleep** | 7-day mean | ≥ 7 h |
| **Lean-gain quality** | since block start | fat < 50% of the gain |
| **Energy balance** | 14-day intake vs maintenance | context — see below |
| **Activity load** | 7 days vs baseline | context |

The goal is a setting. Switching to recomp or fat loss moves the weight band, and the
calorie target follows it automatically.

### Four decisions worth knowing about

**The surplus comes from the band, not from folklore.** "Eat +250 to bulk" works out at
roughly 1 kg a month — above the +0.25–0.5 kg band this app steers by. The surplus is
instead derived from the band's midpoint, about +95 kcal/day, so the two targets can't
contradict each other.

**Energy balance reports as context, not pass/fail.** Maintenance is derived from your own
intake against your own weight trend. That makes intake-minus-target algebraically equal to
the weight trend restated in calories — the two cannot disagree, so scoring both would count
the same evidence twice. It still earns its place by converting a slope into an amount of
food: *"averaging 2,650, that's 95 short — add about that much."*

**A core day is not a fourth session.** Session D — hanging and floor core, Pallof press,
side planks — sits on Wednesday because the trunk recovers fast and 20 minutes of abs costs
almost nothing systemically. That same cheapness is why it doesn't count toward the four:
three sessions plus an ab session is three sessions, and a target that said otherwise would
report a full week that never happened. Core days are logged, shown in the weekly counter,
and paid half XP; the frequency target names them as context.

**Photo estimates are wrong, and that's survivable.** Portion mass is guesswork from a
photo; expect ±20–30%. But because maintenance is measured from those same numbers, a
consistent bias cancels: if every meal reads 15% low, maintenance comes out 15% low too and
the gap you steer by is unchanged. Consistency beats accuracy here. Nothing counts toward a
target until you've confirmed it.

---

## Apple Health

A browser cannot read HealthKit — no API exists. The data is handed over two ways, and you
want both: **[HEALTH-SYNC.md](HEALTH-SYNC.md)** has the Shortcut recipe and the export
walkthrough.

- **Daily** — a Shortcut you build once dumps the day's numbers as JSON; paste or open it
  in the app.
- **One-off** — `export.xml` from Health backfills months of history so trends mean
  something immediately. It's streamed in a Web Worker, since real exports run to hundreds
  of megabytes.

Stored as one summary per day, capped at 400 days (~35 KB).

---

## Photo calorie logging

Point the camera at a plate. The photo is downscaled to 1024px, sent to a Cloudflare Worker
holding your API key, and comes back as typed JSON: items, portions, macros, and the
assumptions it had to make. You adjust portions and confirm before anything is logged.

An API key cannot live in a web page, which is why the Worker exists.
**[DEPLOY.md](DEPLOY.md)** covers setup and costs — about £1.60/month at three photos a day,
with hosting free.

Without a Worker configured, this one tab is disabled and the rest of the app is unaffected.

---

## Development

```bash
npm install
npm run dev            # app on :5173
npm test               # 145 unit tests
npm test -w worker     # 26 worker tests
npm run e2e            # 53 checks in real Chromium against the built app (build first)
npm run typecheck
```

CI runs all of it on every push, then deploys to Pages from the default branch.

### What the tests actually cover

The migration test is the important one: your original training block lives in
`localStorage['calis8w']`, and the port has to move it into IndexedDB without losing a
session. It's asserted in unit tests and again in the browser against a real first boot.
The legacy payload is never deleted and a backup copy is kept.

The XML parser is tested against 1-byte chunk boundaries (every tag split mid-attribute)
and multi-byte UTF-8 straddling a chunk edge, because both are real failure modes on a
400 MB stream.

### Not yet verified

**No live API call has been made.** The container this was built in has no Anthropic
credentials, so the Worker is tested against a stubbed upstream — auth, validation, request
shape, response parsing, error classification — but the real round-trip is unproven. The
first photo you take is the real test.

Two things to check on that first photo:

1. **Cost.** The per-photo figures in DEPLOY.md are arithmetic. Thinking tokens bill as
   output; the Worker sends `effort: "low"` to keep them small, but only a real `usage`
   response confirms it. Every reply echoes `usage`.
2. **The export.xml parser against your actual export.** It's tested against synthetic
   fixtures and handles pounds, kilojoules and timezone offsets, but real exports carry
   locale and device quirks no fixture reproduces. If a day looks wrong, the raw export is
   still on your phone.

---

## Migrating from the original

**The original `index.html` is still at the repo root, deliberately.** If GitHub Pages is
currently set to *deploy from a branch*, that file is what your phone loads, and deleting
it would break the app on your phone the moment this merged. It keeps serving until you
switch **Settings → Pages → Source** to **GitHub Actions**, at which point the new build
takes over the same URL. Delete it whenever you've confirmed the new one works.

Both versions read the same browser storage, so nothing is stranded either way. On first
load the new app finds your old data, migrates it into IndexedDB, and leaves the original
localStorage payload untouched plus a copy under `calis8w.v1.backup`.
