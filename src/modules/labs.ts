import { randomUUID } from 'node:crypto';

import type { ClinicalEvent } from '../events';
import type { Ctx, Effect } from '../effects';

export function orderLab(loinc: string, reason?: string) {
  return (ctx: Ctx): Effect[] => {
    const order: ClinicalEvent = {
      id: randomUUID(),
      pid: ctx.pid,
      t: ctx.now,
      kind: 'ObservationOrdered',
      meta: { loinc, reason }
    };
    const collectAt = ctx.now + Math.max(0.1, ctx.rng('lab-collect').expo(2));
    const resultAt = collectAt + Math.max(0.2, ctx.rng('lab-result').expo(1));
    return [
      { type: 'emit', event: order },
      {
        type: 'schedule',
        at: collectAt,
        thunk: (collectCtx) => {
          const specimen: ClinicalEvent = {
            id: randomUUID(),
            pid: collectCtx.pid,
            t: collectAt,
            kind: 'SpecimenCollected',
            meta: { loinc },
            relatesTo: order.id
          };
          return [{ type: 'emit', event: specimen }];
        }
      },
      {
        type: 'schedule',
        at: resultAt,
        thunk: (resultCtx) => {
          const value = (() => {
            if (loinc === '4548-4') {
              const base = typeof resultCtx.snapshot().attrs.a1c === 'number' ? (resultCtx.snapshot().attrs.a1c as number) : 5.3;
              return Math.max(4.5, resultCtx.rng('lab-value').normal(base, 0.3));
            }
            return resultCtx.rng('lab-value').normal(0, 1);
          })();
          const result: ClinicalEvent = {
            id: randomUUID(),
            pid: resultCtx.pid,
            t: resultAt,
            kind: 'ObservationResulted',
            meta: { loinc, value, unit: loinc === '4548-4' ? '%' : '' },
            relatesTo: order.id
          };
          return [
            { type: 'emit', event: result },
            { type: 'setAttr', key: 'a1c', value }
          ];
        }
      }
    ];
  };
}
