import type { ClinicalEvent } from './events';
import type { RNG } from './rng';
import type { Snapshot } from './state';
import type { Time } from './time';

export interface HazardExplanation {
  scale: 'additive' | 'log-linear';
  rate: number;
  terms: Array<{ label: string; value: number }>;
}

export type Hazard = ((s: Snapshot, t: Time, rng: RNG) => number) & {
  explain?: (s: Snapshot, t: Time) => HazardExplanation;
};

export type HazardModifier = (lambda: number, snapshot: Snapshot, t: Time) => number;

export function applyModifiers(base: Hazard, mods: HazardModifier[], snapshot: Snapshot, t: Time, rng: RNG) {
  const baseRate = base(snapshot, t, rng);
  const final = mods.reduce((acc, mod) => mod(acc, snapshot, t), baseRate);
  return { baseRate, finalRate: final };
}

export type Effect =
  | { type: 'emit'; event: ClinicalEvent }
  | { type: 'setAttr'; key: string; value: unknown }
  | { type: 'setDisease'; disease: string; state: string }
  | { type: 'modifyHazard'; process: string; modifierId: string; apply: HazardModifier; until?: Time }
  | { type: 'schedule'; at: Time; thunk: (ctx: Ctx) => Effect[] };

export interface Ctx {
  readonly now: Time;
  readonly pid: string;
  snapshot(): Snapshot;
  rng(ns?: string): RNG;
}
