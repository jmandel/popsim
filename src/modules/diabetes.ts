import { randomUUID } from 'node:crypto';

import type { Machine } from '../machine';
import type { Hazard } from '../effects';
import { orderLab } from './labs';

type DState = 'SUSC' | 'T2DM' | 'MANAGED';

export function Diabetes(): Machine<DState> {
  const onset: Hazard = Object.assign(
    (snapshot) => {
      const intercept = -7.0;
      const ageTerm = 0.05 * snapshot.attrs.ageYr;
      const bmiTerm = 0.08 * (snapshot.attrs.bmi - 25);
      const sexTerm = snapshot.attrs.sex === 'M' ? 0.2 : 0;
      const smokeTerm = snapshot.attrs.smoker ? 0.15 : 0;
      const logRate = intercept + ageTerm + bmiTerm + sexTerm + smokeTerm;
      return Math.max(1e-6, Math.exp(logRate) / 365);
    },
    {
      explain(snapshot: Parameters<Hazard>[0]) {
        const intercept = -7.0;
        const ageTerm = 0.05 * snapshot.attrs.ageYr;
        const bmiTerm = 0.08 * (snapshot.attrs.bmi - 25);
        const sexTerm = snapshot.attrs.sex === 'M' ? 0.2 : 0;
        const smokeTerm = snapshot.attrs.smoker ? 0.15 : 0;
        const logRate = intercept + ageTerm + bmiTerm + sexTerm + smokeTerm;
        return {
          scale: 'log-linear' as const,
          rate: Math.max(1e-6, Math.exp(logRate) / 365),
          terms: [
            { label: 'intercept', value: intercept },
            { label: 'age', value: ageTerm },
            { label: 'BMI', value: bmiTerm },
            { label: 'sex', value: sexTerm },
            { label: 'smoking', value: smokeTerm }
          ]
        };
      }
    }
  );

  const control: Hazard = Object.assign(
    () => 0.6 / 365,
    {
      explain() {
        return {
          scale: 'additive' as const,
          rate: 0.6 / 365,
          terms: [{ label: 'baseline', value: 0.6 / 365 }]
        };
      }
    }
  );

  return {
    id: 't2dm',
    states: ['SUSC', 'T2DM', 'MANAGED'] as const,
    initial: 'SUSC',
    transitions: [
      {
        from: 'SUSC',
        to: 'T2DM',
        hazard: onset,
        onFire: (ctx) => [
          {
            type: 'emit',
            event: {
              id: randomUUID(),
              pid: ctx.pid,
              t: ctx.now,
              kind: 'ConditionOnset',
              meta: { icd10: 'E11.9', label: 'Type 2 diabetes' }
            }
          }
        ]
      },
      {
        from: 'T2DM',
        to: 'MANAGED',
        hazard: control,
        onFire: (ctx) => [
          {
            type: 'emit',
            event: {
              id: randomUUID(),
              pid: ctx.pid,
              t: ctx.now,
              kind: 'MedicationStarted',
              meta: { rxNorm: 'Metformin', dose: '500 mg BID' }
            }
          }
        ]
      }
    ],
    watches: [
      {
        id: 'order-a1c-at-visit',
        match: (event) => event.kind === 'EncounterFinished' && event.meta?.type === 'PCP',
        react: (_event, ctx) => {
          const snapshot = ctx.snapshot();
          const suspect = snapshot.attrs.bmi >= 30 || (typeof snapshot.attrs.a1c === 'number' && (snapshot.attrs.a1c as number) > 6.3);
          if (snapshot.diseases['t2dm'] !== 'SUSC' || suspect) {
            return orderLab('4548-4', 'diabetes screening')(ctx);
          }
          return [];
        }
      },
      {
        id: 'diagnose-on-high-a1c',
        match: (event) => event.kind === 'ObservationResulted' && event.meta?.loinc === '4548-4',
        react: (event, ctx) => {
          const value = typeof event.meta?.value === 'number' ? (event.meta.value as number) : NaN;
          if (value >= 6.5 && ctx.snapshot().diseases['t2dm'] === 'SUSC') {
            return [
              { type: 'setDisease', disease: 't2dm', state: 'T2DM' },
              {
                type: 'emit',
                event: {
                  id: randomUUID(),
                  pid: ctx.pid,
                  t: event.t,
                  kind: 'ConditionOnset',
                  relatesTo: event.id,
                  meta: { icd10: 'E11.9', label: 'Type 2 diabetes (lab-confirmed)' }
                }
              }
            ];
          }
          return [];
        }
      }
    ]
  } satisfies Machine<DState>;
}
