/**
 * Screenshot the running dev server. Not part of CI — a hand tool for
 * "show me what it looks like right now".
 *
 * Usage: node e2e/shot.mjs [url] [outDir] [WxH ...]
 *
 * Sizes default to the phone the app was built for. Pass others to check the
 * wider layouts, e.g. 834x1194 (iPad Pro 11 portrait) and 1194x834 (landscape);
 * each size gets its own subdirectory.
 */
import { chromium } from 'playwright';
import { readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = resolve(process.argv[3] ?? 'e2e/shots/live');
const SIZES = (process.argv.slice(4).length ? process.argv.slice(4) : ['414x896']).map((s) => {
  const [width, height] = s.split('x').map(Number);
  if (!width || !height) throw new Error(`bad size "${s}" — expected WxH`);
  return { name: s, width, height };
});

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (err) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    if (!existsSync(root)) throw err;
    const candidates = [];
    for (const dir of await readdir(root)) {
      if (!dir.startsWith('chromium')) continue;
      candidates.push(
        join(root, dir, 'chrome-linux', 'chrome'),
        join(root, dir, 'chrome-linux', 'headless_shell'),
        join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      );
    }
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw err;
    return chromium.launch({ executablePath: found });
  }
}

/** Seeded so the screenshots show a populated app rather than empty states. */
const V1 = {
  start: '2026-08-04',
  ladders: { pullup: 3, pushup: 2, pike: 1, squat: 4, core: 1, floor: 0 },
  sessions: [
    { date: '2026-08-04', type: 'A', sets: [8, 7, 6, 6], best: { pullup: 8 } },
    { date: '2026-08-05', type: 'C', rounds: 12 },
    { date: '2026-08-07', type: 'B', sets: [9, 8, 8, 7, 7], best: { pullup: 9 } },
    { date: '2026-08-31', type: 'A', sets: [9, 8, 8, 7], best: { pullup: 9 } },
    { date: '2026-08-30', type: 'C', rounds: 14 },
    { date: '2026-08-28', type: 'B', sets: [10, 9, 9, 8, 8], best: { pullup: 10 } },
    { date: '2026-08-27', type: 'A', sets: [9, 9, 8, 8], best: { pullup: 9 } },
  ],
  weights: [],
  seen: ['first'],
};

function health() {
  const days = {};
  const iso = (n) => new Date(Date.UTC(2026, 8, 1) - n * 864e5).toISOString().slice(0, 10);
  for (let i = 27; i >= 0; i--) {
    days[iso(i)] = {
      wt: Math.round((71.2 + (27 - i) * (0.4 / 27)) * 100) / 100,
      bf: 14.4 - (27 - i) * 0.005,
      rhr: 51 + (i < 7 ? 0 : 0),
      hrv: 66,
      sleep: i < 7 ? 6.2 : 7.4,
      steps: 8412,
      aen: 540,
      wo: i % 2 === 0 ? 1 : 0,
    };
  }
  return days;
}

const TABS = [
  ['Today', 'today'],
  ['Target', 'target'],
  ['Ladders', 'ladders'],
  ['Food', 'food'],
  ['Stats', 'stats'],
  ['Setup', 'setup'],
];

const browser = await launchChromium();

for (const size of SIZES) {
  const dir = SIZES.length > 1 ? join(OUT, size.name) : OUT;
  await mkdir(dir, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.addInitScript((v1) => localStorage.setItem('calis8w', JSON.stringify(v1)), V1);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('header h1', { timeout: 20000 });

  // Seed Health data through the app's own import path, not by writing the DB.
  await page.locator('nav button', { hasText: 'Target' }).click();
  const payload = JSON.stringify({
    t: 'health8w',
    v: 1,
    days: Object.entries(health()).map(([d, day]) => ({ d, ...day })),
  });
  await page.locator('.fold summary').click();
  await page.locator('textarea.paste').fill(payload);
  await page.locator('button', { hasText: 'Import pasted' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('kg/mo'), { timeout: 20000 });

  for (const [label, name] of TABS) {
    await page.locator('nav button', { hasText: label }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    console.log(`shot: ${size.name}/${name}.png`);
  }

  await ctx.close();
}

await browser.close();
console.log(`\nScreenshots in ${OUT}`);
