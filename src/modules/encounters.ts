import { randomUUID } from 'node:crypto';

import type { ClinicalEvent } from '../events';
import type { Machine } from '../machine';
import type { Hazard } from '../effects';

export function Encounters(): Machine<'IDLE'> {
  const cadence: Hazard = Object.assign(
    (snapshot, _t, _rng) => {
      const hasChronic = ['t2dm'].some((k) => {
        const state = snapshot.diseases[k];
        return state && state !== 'SUSC';
      });
      const base = 2 / 365;
      const chronic = hasChronic ? 1 / 365 : 0;
      const ageBoost = snapshot.attrs.ageYr > 65 ? 0.5 / 365 : 0;
      return base + chronic + ageBoost;
    },
    {
      explain(snapshot: Parameters<Hazard>[0]) {
        const hasChronic = ['t2dm'].some((k) => {
          const state = snapshot.diseases[k];
          return state && state !== 'SUSC';
        });
        const base = 2 / 365;
        const chronic = hasChronic ? 1 / 365 : 0;
        const ageBoost = snapshot.attrs.ageYr > 65 ? 0.5 / 365 : 0;
        return {
          scale: 'additive' as const,
          rate: base + chronic + ageBoost,
          terms: [
            { label: 'baseline', value: base },
            { label: 'chronic disease boost', value: chronic },
            { label: 'age boost', value: ageBoost }
          ]
        };
      }
    }
  );

  return {
    id: 'encounters',
    states: ['IDLE'] as const,
    initial: 'IDLE',
    transitions: [
      {
        from: 'IDLE',
        to: 'IDLE',
        hazard: cadence,
        onFire: (ctx) => {
          const start: ClinicalEvent = {
            id: randomUUID(),
            pid: ctx.pid,
            t: ctx.now,
            kind: 'EncounterStarted',
            meta: { type: 'PCP' }
          };
          const duration = Math.max(0.02, ctx.rng('encounter-duration').normal(0.05, 0.02));
          const finishAt = ctx.now + duration;
          return [
            { type: 'emit', event: start },
            {
              type: 'schedule',
              at: finishAt,
              thunk: (thunkCtx) => {
                const finish: ClinicalEvent = {
                  id: randomUUID(),
                  pid: thunkCtx.pid,
                  t: finishAt,
                  kind: 'EncounterFinished',
                  meta: { type: 'PCP' },
                  relatesTo: start.id
                };
                return [{ type: 'emit', event: finish }];
              }
            }
          ];
        }
      }
    ]
  } satisfies Machine<'IDLE'>;
}
