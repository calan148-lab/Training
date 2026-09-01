import { describe, expect, it } from 'vitest';
import { HealthExportAccumulator, parseHealthExport, parseStamp } from './exportXml';

function rec(type: string, start: string, value: string, extra = ''): string {
  return `<Record type="${type}" sourceName="Watch" unit="count" startDate="${start}" endDate="${start}" value="${value}"${extra}/>`;
}

describe('parseStamp', () => {
  it('parses Health timestamps with their offset', () => {
    const t = parseStamp('2026-08-31 08:12:03 +0200');
    expect(t).toBe(Date.parse('2026-08-31T08:12:03+02:00'));
  });

  it('returns null on junk', () => {
    expect(parseStamp('nonsense')).toBeNull();
    expect(parseStamp(undefined)).toBeNull();
  });
});

describe('HealthExportAccumulator', () => {
  function run(xml: string, chunkSize?: number) {
    const acc = new HealthExportAccumulator();
    if (chunkSize) {
      for (let i = 0; i < xml.length; i += chunkSize) acc.push(xml.slice(i, i + chunkSize));
    } else {
      acc.push(xml);
    }
    acc.end();
    return acc.result();
  }

  it('takes the last body-mass reading of the day', () => {
    const xml =
      rec('HKQuantityTypeIdentifierBodyMass', '2026-08-31 07:00:00 +0000', '71.0') +
      rec('HKQuantityTypeIdentifierBodyMass', '2026-08-31 19:00:00 +0000', '71.6');
    expect(run(xml)[0]).toMatchObject({ d: '2026-08-31', wt: 71.6 });
  });

  it('takes the last reading even when records arrive out of order', () => {
    const xml =
      rec('HKQuantityTypeIdentifierBodyMass', '2026-08-31 19:00:00 +0000', '71.6') +
      rec('HKQuantityTypeIdentifierBodyMass', '2026-08-31 07:00:00 +0000', '71.0');
    expect(run(xml)[0]!.wt).toBe(71.6);
  });

  it('converts pounds to kilograms', () => {
    const xml = rec('HKQuantityTypeIdentifierBodyMass', '2026-08-31 07:00:00 +0000', '160').replace(
      'unit="count"',
      'unit="lb"',
    );
    expect(run(xml)[0]!.wt).toBeCloseTo(72.57, 1);
  });

  it('sums steps and active energy across the day', () => {
    const xml =
      rec('HKQuantityTypeIdentifierStepCount', '2026-08-31 07:00:00 +0000', '4000') +
      rec('HKQuantityTypeIdentifierStepCount', '2026-08-31 18:00:00 +0000', '4412') +
      rec('HKQuantityTypeIdentifierActiveEnergyBurned', '2026-08-31 07:00:00 +0000', '240') +
      rec('HKQuantityTypeIdentifierActiveEnergyBurned', '2026-08-31 18:00:00 +0000', '300');
    expect(run(xml)[0]).toMatchObject({ steps: 8412, aen: 540 });
  });

  it('converts kilojoules to kilocalories', () => {
    const xml = rec('HKQuantityTypeIdentifierActiveEnergyBurned', '2026-08-31 07:00:00 +0000', '4184').replace(
      'unit="count"',
      'unit="kJ"',
    );
    expect(run(xml)[0]!.aen).toBe(1000);
  });

  it('averages resting heart rate and HRV', () => {
    const xml =
      rec('HKQuantityTypeIdentifierRestingHeartRate', '2026-08-31 07:00:00 +0000', '50') +
      rec('HKQuantityTypeIdentifierRestingHeartRate', '2026-08-31 08:00:00 +0000', '54') +
      rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', '2026-08-31 07:00:00 +0000', '60') +
      rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', '2026-08-31 08:00:00 +0000', '70');
    expect(run(xml)[0]).toMatchObject({ rhr: 52, hrv: 65 });
  });

  it('reads body fat stored as a fraction or as whole percent', () => {
    const frac = rec('HKQuantityTypeIdentifierBodyFatPercentage', '2026-08-31 07:00:00 +0000', '0.142');
    expect(run(frac)[0]!.bf).toBeCloseTo(14.2, 1);
    const whole = rec('HKQuantityTypeIdentifierBodyFatPercentage', '2026-08-31 07:00:00 +0000', '14.2');
    expect(run(whole)[0]!.bf).toBeCloseTo(14.2, 1);
  });

  it('sums asleep intervals and attributes them to the waking day', () => {
    const xml =
      `<Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-08-30 23:00:00 +0000" endDate="2026-08-31 03:00:00 +0000" value="HKCategoryValueSleepAnalysisAsleepCore"/>` +
      `<Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-08-31 03:00:00 +0000" endDate="2026-08-31 06:30:00 +0000" value="HKCategoryValueSleepAnalysisAsleepREM"/>`;
    const days = run(xml);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ d: '2026-08-31', sleep: 7.5 });
  });

  it('ignores in-bed and awake sleep records', () => {
    const xml =
      `<Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-08-30 22:00:00 +0000" endDate="2026-08-31 07:00:00 +0000" value="HKCategoryValueSleepAnalysisInBed"/>` +
      `<Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-08-31 03:00:00 +0000" endDate="2026-08-31 03:20:00 +0000" value="HKCategoryValueSleepAnalysisAwake"/>`;
    expect(run(xml)).toEqual([]);
  });

  it('counts workouts', () => {
    const xml =
      `<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" startDate="2026-08-31 17:00:00 +0000" endDate="2026-08-31 17:45:00 +0000"/>` +
      `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="30" startDate="2026-08-31 09:00:00 +0000" endDate="2026-08-31 09:30:00 +0000"/>`;
    expect(run(xml)[0]).toMatchObject({ d: '2026-08-31', wo: 2 });
  });

  it('handles records that carry nested metadata children', () => {
    const xml =
      `<Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-08-31 07:00:00 +0000" endDate="2026-08-31 08:00:00 +0000" value="1000">` +
      `<MetadataEntry key="HKWasUserEntered" value="0"/></Record>`;
    expect(run(xml)[0]!.steps).toBe(1000);
  });

  it('ignores record types it does not track', () => {
    expect(run(rec('HKQuantityTypeIdentifierDietaryWater', '2026-08-31 07:00:00 +0000', '500'))).toEqual([]);
  });

  it('produces identical results whatever the chunk boundaries', () => {
    const xml =
      Array.from({ length: 40 }, (_, i) =>
        rec('HKQuantityTypeIdentifierStepCount', `2026-08-${String((i % 28) + 1).padStart(2, '0')} 07:00:00 +0000`, '100'),
      ).join('') +
      `<Workout workoutActivityType="X" duration="1" startDate="2026-08-05 07:00:00 +0000" endDate="2026-08-05 08:00:00 +0000"/>`;

    const whole = run(xml);
    // 1-byte chunks split every tag mid-attribute; 7 and 13 land arbitrarily.
    for (const size of [1, 7, 13, 64, 999]) {
      expect(run(xml, size)).toEqual(whole);
    }
  });

  it('returns days sorted oldest first', () => {
    const xml =
      rec('HKQuantityTypeIdentifierStepCount', '2026-08-31 07:00:00 +0000', '1') +
      rec('HKQuantityTypeIdentifierStepCount', '2026-08-01 07:00:00 +0000', '1') +
      rec('HKQuantityTypeIdentifierStepCount', '2026-08-15 07:00:00 +0000', '1');
    expect(run(xml).map((d) => d.d)).toEqual(['2026-08-01', '2026-08-15', '2026-08-31']);
  });
});

describe('parseHealthExport', () => {
  it('streams a blob and reports progress reaching 100%', async () => {
    const body = Array.from({ length: 500 }, (_, i) =>
      rec('HKQuantityTypeIdentifierStepCount', `2026-08-${String((i % 28) + 1).padStart(2, '0')} 07:00:00 +0000`, '10'),
    ).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_GB">\n${body}\n</HealthData>`;
    const blob = new Blob([xml], { type: 'application/xml' });

    const seen: number[] = [];
    const days = await parseHealthExport(blob, (p) => seen.push(p.bytesRead));

    expect(days).toHaveLength(28);
    expect(days.reduce((a, d) => a + (d.steps ?? 0), 0)).toBe(5000);
    expect(seen[seen.length - 1]).toBe(blob.size);
  });

  it('survives multi-byte characters split across chunk boundaries', async () => {
    // Source names in real exports carry non-ASCII; a naive decoder mangles them
    // and can corrupt the tag that follows.
    const xml =
      `<HealthData>` +
      `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Måns’ iPhone — 日本語" unit="count" startDate="2026-08-31 07:00:00 +0000" endDate="2026-08-31 08:00:00 +0000" value="1234"/>` +
      `</HealthData>`;
    const days = await parseHealthExport(new Blob([xml]));
    expect(days[0]).toMatchObject({ d: '2026-08-31', steps: 1234 });
  });
});
