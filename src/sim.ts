import { mkdir } from 'node:fs/promises';

import type { WorldFile } from './contracts';
import { runKernel } from './kernel';
import { Diabetes } from './modules/diabetes';
import { Encounters } from './modules/encounters';
import { RNG } from './rng';
import type { ClinicalEvent } from './events';
import type { Snapshot } from './state';

export type SimulationOptions = {
  n: number;
  world: WorldFile;
  horizonYears?: number;
  explain?: boolean;
  llmRuntime?: boolean;
};

export type SimulationPatient = {
  id: string;
  birthYear: number;
  attrs: Record<string, unknown>;
  diseases: Record<string, string>;
  events: ClinicalEvent[];
};

export async function runSimulation(opts: SimulationOptions): Promise<SimulationPatient[]> {
  const seed = opts.world.seed ?? 42;
  const horizonYears = opts.horizonYears ?? 5;
  const horizonDays = horizonYears * 365;

  const patients: SimulationPatient[] = [];
  for (let i = 0; i < opts.n; i++) {
    const rng = new RNG((seed + i * 7919) >>> 0);
    const pid = `P${String(i + 1).padStart(4, '0')}`;
    const birthYear = 1940 + Math.floor(rng.float() * 60);
    const age = 18 + rng.float() * 60;
    const sex = rng.float() < 0.5 ? 'F' : 'M';
    const bmi = Math.max(16, Math.min(45, rng.normal(27, 4)));
    const smoker = rng.float() < 0.25;
    const baselineA1c = Math.max(4.8, rng.normal(5.3 + (bmi - 25) * 0.05, 0.4));

    const attrs: Record<string, unknown> = {
      ageYr: age,
      AGE_YEARS: age,
      AGE_YEARS_BASELINE: age,
      sex,
      SEX_AT_BIRTH: sex,
      bmi,
      BMI: bmi,
      smoker,
      SMOKER: smoker,
      a1c: baselineA1c
    };

    const snapshot: Snapshot = { attrs: attrs as any, diseases: {} };
    const result = runKernel({
      pid,
      machines: [Encounters(), Diabetes()],
      initialSnapshot: snapshot,
      rng,
      start: 0,
      horizon: horizonDays,
      explain: opts.explain,
      logger: opts.explain ? (msg) => console.log(msg) : undefined
    });

    const patient: SimulationPatient = {
      id: pid,
      birthYear,
      attrs: { ...result.snapshot.attrs } as Record<string, unknown>,
      diseases: { ...result.snapshot.diseases },
      events: result.events
    };
    patients.push(patient);
  }

  const totalEvents = patients.reduce((sum, p) => sum + p.events.length, 0);
  const deathFraction =
    patients.filter((p) => p.events.some((e) => e.kind === 'Death')).length / Math.max(1, patients.length);
  const conditionEvents = patients.reduce(
    (sum, p) => sum + p.events.filter((e) => e.kind === 'ConditionOnset').length,
    0
  );
  const summary = {
    patients: patients.length,
    avgEventsPerPatient: totalEvents / Math.max(1, patients.length),
    conditionOnsets: conditionEvents,
    deathFraction
  };
  await mkdir('out/sim', { recursive: true });
  await Bun.write('out/sim/summary.json', JSON.stringify(summary, null, 2));

  return patients;
}
