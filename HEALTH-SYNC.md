# Getting Apple Health data into the app

A web page cannot read Apple Health. There is no browser API for HealthKit and no
permission you can grant to create one — the data has to be handed over deliberately.
There are two ways to do that, and you want both: the Shortcut for the daily drip, the
export once to seed history.

---

## Route 1 — the Shortcut (daily)

You build this once. After that it runs on a schedule and you pick one file.

**Nothing leaves your phone.** The Shortcut writes a file to your own iCloud Drive;
the app reads it locally. There is no server and no account anywhere in this path.

### The one design decision that matters

**Make the Shortcut emit a trailing window — the last 7 days — not just yesterday.**

It costs nothing and it makes the whole thing self-healing. Miss a few days, go on
holiday, forget the app exists for a week: the next single import backfills everything.
Merging is idempotent and field-by-field, so re-importing days you already have is
free — the app will tell you "2 new days, 5 updated" rather than pretending it did
nothing.

The alternative — emitting only yesterday — means every day you don't open the app is
a day lost forever. Don't do that.

### What it has to produce

```json
{
  "t": "health8w",
  "v": 1,
  "days": [
    {
      "d": "2026-08-31",
      "wt": 71.4,
      "bf": 14.2,
      "rhr": 52,
      "hrv": 68,
      "sleep": 7.2,
      "steps": 8412,
      "aen": 540,
      "wo": 1
    }
  ]
}
```

| Key | Meaning | Unit |
|---|---|---|
| `d` | Date | `YYYY-MM-DD` |
| `wt` | Body mass | kg |
| `bf` | Body fat | percent (14.2, not 0.142) |
| `rhr` | Resting heart rate | bpm |
| `hrv` | Heart rate variability (SDNN) | ms |
| `sleep` | Time asleep | hours |
| `steps` | Step count | count |
| `aen` | Active energy burned | kcal |
| `wo` | Workouts recorded | count |

**Every field except `d` is optional.** Leave out what you don't have. A missing key
never erases what the app already stored, so a Shortcut that only reports body fat on
days you used the scale is fine — that is the intended shape, not a compromise.

**The wrapper is optional too.** All three of these are accepted, so there is less to
get wrong by hand:

```json
{"t":"health8w","v":1,"days":[ … ]}     ← full form
[ {"d":"2026-08-31","wt":71.4}, … ]      ← just the array
{"d":"2026-08-31","wt":71.4}             ← a single day
```

If you *do* include `"t"` and `"v"`, they must be right — that check exists so a
Shortcut left on an old contract fails loudly instead of silently writing nothing.

Values outside plausible bounds are dropped rather than stored, so a Shortcut
accidentally wired to grams won't corrupt your weight trend.

### Building it

In the Shortcuts app, new shortcut, then:

1. **Repeat with Each** over the last 7 days. Simplest version: add a **Number** action
   set to `7`, then **Repeat** that many times; inside the loop, take the current date,
   **Adjust Date** by minus `Repeat Index` days, and **Format Date** as `yyyy-MM-dd`.
2. Inside the loop, for each metric you want, add **Find Health Samples**:
   - Set the type (Body Mass, Resting Heart Rate, Steps, and so on).
   - Filter `Start Date` `is` the date from step 1.
   - Choose the aggregation the app expects — *Average* for resting heart rate and
     HRV, *Sum* for steps and active energy, *Latest* for body mass and body fat.
3. **Text** — assemble one `{"d": …, …}` object per iteration.
4. After the loop, **Combine Text** with `,` as separator, wrap in `[` `]`.
5. **Save File** → iCloud Drive, a fixed path like `Shortcuts/health.json`,
   with *Overwrite If File Exists* switched on.

Overwriting one fixed file is deliberate: you always pick the same file, and because
it carries a rolling week you never need to hunt for older ones.

Then open the app → **Target** → **Import from Files** → pick `health.json`.

Exact action names shift between iOS releases; if one of the above isn't where this
says, it will be within one menu of it.

### Making it run on its own

Shortcuts → **Automation** → new personal automation → **Time of Day**, early morning,
run your shortcut, and turn **Ask Before Running** off. The file is then always current
when you open the app.

### If you've been away

Pick as many files as you like at once — the picker accepts multiple selection and
pools them, later files winning on conflict. With the rolling-week Shortcut you
shouldn't need this, but it's there if you ever switch to one-file-per-day.

### Pasting instead

The app still takes a paste, tucked under *Paste instead* on the Target tab. Swap the
**Save File** action for **Copy to Clipboard** if you prefer that. It works identically —
it's just one more manual step each time.

## Route 2 — the full export (once)

This backfills months or years of history, so the trends mean something on day one rather
than in three weeks.

1. Health app → tap your photo, top right → **Export All Health Data**.
2. It produces `export.zip`. It can take several minutes, and on a phone with years of
   history the file runs to hundreds of megabytes.
3. Save it to **Files**.
4. **Uncompress it there** — long-press the zip → *Uncompress*. You want `export.xml`.
5. In the app: **Target** → *Pick export.xml*.

### Why you have to uncompress it yourself

Unzipping in the browser would mean loading a compression library from a CDN, which would
break the app offline for the sake of one action you take about twice a year. Reading the
XML directly keeps the app dependency-free.

The file is far too large to load into memory, so it is streamed and folded into one
summary per day as it goes — you'll see a progress bar and a running record count. Only
these types are kept; everything else in the export is skipped:

| HealthKit type | How it is rolled up |
|---|---|
| `BodyMass`, `BodyFatPercentage` | last reading of the day |
| `StepCount`, `ActiveEnergyBurned` | summed |
| `RestingHeartRate`, `HeartRateVariabilitySDNN` | averaged |
| `SleepAnalysis` (asleep stages only) | summed hours, credited to the day you woke |
| `Workout` | counted |

Pounds convert to kilograms and kilojoules to kilocalories automatically. `InBed` and
`Awake` sleep records are ignored — only genuine asleep stages count.

### More than one device

Once you own a phone, a watch and a ring, several of them write the same metrics to
Health. The Health app hides this by picking one source per data type; the raw export
contains every record from every device, so the import has to resolve them itself:

- **Totals** (steps, active energy, sleep, workouts) take the **largest single source**,
  never the sum. Adding devices together turns one night watched by two of them into
  sixteen hours of sleep.
- **Averages** (resting heart rate, HRV) take the **source with the most samples** that
  day, rather than blending. A ring and a watch measure resting heart rate differently,
  and an average is a figure neither reported — one that shifts whenever a device misses
  a day, which is exactly the drift the recovery target is watching for.
- **Weight and body fat** take the latest reading, whichever device wrote it.

This only affects the `export.xml` route. The Shortcut route asks Health for the value,
and Health has already picked a source.

### Adding an Oura ring

Nothing to configure. Turn on Oura's Apple Health integration and it writes sleep, HRV,
resting heart rate and activity into Health; the Shortcut reads Health, so it is picked
up with no change. The rules above handle the overlap with an Apple Watch.

Oura's own derived scores — readiness, sleep score, body temperature deviation — are not
written to Health and would need Oura's cloud API, which means a server and data leaving
the device. Not built, deliberately.

The app keeps the most recent **400 days** and drops the rest, which is about 35 KB of
storage. Importing a decade is safe; you just won't be able to scroll back a decade.

---

## Where the data lives

On the phone, in the browser's IndexedDB. It is never uploaded anywhere. That also means
**clearing Safari's website data deletes it** — so export a backup from the Stats tab now
and then. The backup file lands in Files, where iCloud picks it up.
