import type { ClinicalEvent } from './events';
import type { Ctx, Effect, Hazard, HazardModifier } from './effects';

export interface Transition<S extends string> {
  from: S;
  to: S;
  hazard: Hazard;
  onFire?: (ctx: Ctx) => Effect[];
}

export type Watcher = {
  id: string;
  match: (event: ClinicalEvent) => boolean;
  react: (event: ClinicalEvent, ctx: Ctx) => Effect[];
};

export interface Machine<S extends string> {
  id: string;
  states: readonly S[];
  initial: S;
  transitions: readonly Transition<S>[];
  watches?: ReadonlyArray<Watcher>;
  modifiers?: () => Record<string, HazardModifier>;
}
