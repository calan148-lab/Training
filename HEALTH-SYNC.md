# Getting Apple Health data into the app

A web page cannot read Apple Health. There is no browser API for HealthKit and no
permission you can grant to create one — the data has to be handed over deliberately.
There are two ways to do that, and you want both: the Shortcut for the daily drip, the
export once to seed history.

---

## Route 1 — the Shortcut (daily)

You build this once. After that it is one tap, or fully automatic.

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

**Every field except `d` is optional.** Leave out what you don't have. A missing key never
erases what the app already stored, so a Shortcut that only reports body fat on days you
used the scale is fine — that is the intended shape, not a compromise.

Values outside plausible bounds are dropped rather than stored, so a Shortcut accidentally
wired to grams won't corrupt your weight trend.

### Building it

In the Shortcuts app, new shortcut, then:

1. **Date** → set to yesterday (`Adjust Date` → subtract 1 day). Yesterday rather than today
   because today's step count and active energy aren't finished yet.
2. **Format Date** → `yyyy-MM-dd`. Store this in a variable named `Day`.
3. For each metric you want, add **Find Health Samples**:
   - Set the type (Body Mass, Resting Heart Rate, Steps, and so on).
   - Filter `Start Date` `is today` relative to the date from step 1.
   - Set **Sort by** `Start Date`, and choose the aggregation the app expects — *Average*
     for resting heart rate and HRV, *Sum* for steps and active energy, *Latest* for body
     mass and body fat.
   - Store each result in its own variable.
4. **Text** — assemble the JSON above, dropping in your variables.
5. **Copy to Clipboard**, or **Save File** to iCloud Drive if you'd rather pick a file.

Then open the app, go to **Target**, and paste into the box (or pick the file).

Exact action names shift between iOS releases; if one of the above isn't where this says,
it will be within one menu of it.

### Making it automatic

Shortcuts → **Automation** → new personal automation → **Time of Day**, early morning,
run your shortcut. Set it to run without asking. The day's numbers are then on your
clipboard when you next open the app.

### If the app says the Shortcut is out of date

The `v` field is the contract version. If the app is bumped to `v: 2` and your Shortcut
still sends `v: 1`, the import is refused with a message saying so. That is deliberate —
a silent partial import is worse than a loud failure. Update the `Text` action to match
the table above.

---

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

The app keeps the most recent **400 days** and drops the rest, which is about 35 KB of
storage. Importing a decade is safe; you just won't be able to scroll back a decade.

---

## Where the data lives

On the phone, in the browser's IndexedDB. It is never uploaded anywhere. That also means
**clearing Safari's website data deletes it** — so export a backup from the Stats tab now
and then. The backup file lands in Files, where iCloud picks it up.
