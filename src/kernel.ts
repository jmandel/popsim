import type { ClinicalEvent } from './events';
import type { Effect, HazardExplanation } from './effects';
import type { Machine, Transition, Watcher } from './machine';
import type { Snapshot } from './state';
import type { Time } from './time';
import { RNG } from './rng';
import type { HazardModifier } from './effects';
import type { Ctx } from './effects';

interface KernelOptions {
  pid: string;
  machines: ReadonlyArray<Machine<any>>;
  initialSnapshot: Snapshot;
  rng: RNG;
  start: Time;
  horizon: Time;
  explain?: boolean;
  logger?: (msg: string) => void;
}

interface TransitionDetail {
  baseRate: number;
  finalRate: number;
  explanation?: HazardExplanation;
  modifiers: Array<{ id: string; after: number }>;
}

type ScheduledItem =
  | { kind: 'transition'; time: Time; machineId: string; transitionIndex: number; version: number; detail: TransitionDetail }
  | { kind: 'thunk'; time: Time; thunk: (ctx: Ctx) => Effect[] };

class MinQueue<T extends { time: Time }> {
  private readonly data: Array<{ time: Time; seq: number; item: T }> = [];
  private seq = 0;

  push(item: T) {
    const entry = { time: item.time, seq: this.seq++, item };
    let lo = 0;
    let hi = this.data.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const cmp = this.data[mid].time - entry.time || this.data[mid].seq - entry.seq;
      if (cmp <= 0) lo = mid + 1;
      else hi = mid;
    }
    this.data.splice(lo, 0, entry);
  }

  pop(): T | undefined {
    const entry = this.data.shift();
    return entry?.item;
  }

  get length() {
    return this.data.length;
  }
}

class KernelCtx implements Ctx {
  private rngStreams = new Map<string, RNG>();

  constructor(private readonly state: KernelState) {}

  get now(): Time {
    return this.state.now;
  }

  get pid(): string {
    return this.state.pid;
  }

  snapshot(): Snapshot {
    return this.state.snapshot();
  }

  rng(ns = 'default'): RNG {
    if (!this.rngStreams.has(ns)) {
      this.rngStreams.set(ns, this.state.baseRng.child(`${ns}:${this.state.streamSeed++}`));
    }
    return this.rngStreams.get(ns)!;
  }
}

interface ModifierEntry {
  apply: HazardModifier;
  token: number;
}

interface MachineRuntime {
  state: string;
  version: number;
}

class KernelState {
  readonly pid: string;
  now: Time;
  readonly baseRng: RNG;
  readonly horizon: Time;
  readonly logger?: (msg: string) => void;
  readonly explain: boolean;

  private attrs: Record<string, unknown>;
  private readonly ageBase: number;
  private diseases: Record<string, string>;
  private readonly machines: Map<string, Machine<any>>;
  private readonly runtimes: Map<string, MachineRuntime> = new Map();
  private readonly modifiers: Map<string, Map<string, ModifierEntry>> = new Map();
  private readonly watchers: Watcher[];
  private readonly pq = new MinQueue<ScheduledItem>();
  private readonly events: ClinicalEvent[] = [];
  private modifierToken = 1;
  streamSeed = 1;

  constructor(opts: KernelOptions) {
    this.pid = opts.pid;
    this.now = opts.start;
    this.horizon = opts.horizon;
    this.baseRng = opts.rng;
    this.logger = opts.logger;
    this.explain = !!opts.explain;

    this.attrs = { ...opts.initialSnapshot.attrs };
    this.ageBase = typeof opts.initialSnapshot.attrs.ageYr === 'number' ? (opts.initialSnapshot.attrs.ageYr as number) : 40;
    (this.attrs as any).ageYr = this.ageBase;
    (this.attrs as any).AGE_YEARS = this.ageBase;
    this.diseases = { ...opts.initialSnapshot.diseases };

    this.machines = new Map(opts.machines.map((m) => [m.id, m]));
    this.watchers = opts.machines.flatMap((m) => m.watches ?? []);

    for (const machine of opts.machines) {
      this.diseases[machine.id] = this.diseases[machine.id] ?? machine.initial;
      this.runtimes.set(machine.id, { state: this.diseases[machine.id], version: 0 });
      if (machine.modifiers) {
        const modCatalog = machine.modifiers();
        const entries = new Map<string, ModifierEntry>();
        for (const [id, apply] of Object.entries(modCatalog)) {
          entries.set(id, { apply, token: this.modifierToken++ });
        }
        if (entries.size) this.modifiers.set(machine.id, entries);
      }
    }
  }

  getEvents(): ClinicalEvent[] {
    return this.events;
  }

  snapshot(): Snapshot {
    return {
      attrs: { ...(this.attrs as any) },
      diseases: { ...this.diseases }
    };
  }

  advanceTo(time: Time) {
    this.now = time;
    const age = this.ageBase + time / 365;
    (this.attrs as any).ageYr = age;
    (this.attrs as any).AGE_YEARS = age;
  }

  enqueue(item: ScheduledItem) {
    this.pq.push(item);
  }

  nextItem(): ScheduledItem | undefined {
    return this.pq.pop();
  }

  queueLength() {
    return this.pq.length;
  }

  appendEvent(event: ClinicalEvent) {
    this.events.push(event);
  }

  setAttr(key: string, value: unknown) {
    this.attrs = { ...this.attrs, [key]: value };
  }

  setDisease(id: string, state: string) {
    if (this.diseases[id] === state) return;
    this.diseases = { ...this.diseases, [id]: state };
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.state = state;
      runtime.version += 1;
      this.scheduleMachine(id);
    }
  }

  addModifier(process: string, modifierId: string, apply: HazardModifier): number {
    let bucket = this.modifiers.get(process);
    if (!bucket) {
      bucket = new Map();
      this.modifiers.set(process, bucket);
    }
    const token = this.modifierToken++;
    bucket.set(modifierId, { apply, token });
    this.scheduleMachine(process);
    return token;
  }

  removeModifier(process: string, modifierId: string, expectedToken: number) {
    const bucket = this.modifiers.get(process);
    if (!bucket) return;
    const entry = bucket.get(modifierId);
    if (!entry || entry.token !== expectedToken) return;
    bucket.delete(modifierId);
    if (!bucket.size) this.modifiers.delete(process);
    this.scheduleMachine(process);
  }

  private scheduleMachine(machineId: string) {
    const machine = this.machines.get(machineId);
    const runtime = this.runtimes.get(machineId);
    if (!machine || !runtime) return;
    runtime.version += 1;
    const version = runtime.version;
    const transitions = machine.transitions.filter((t) => t.from === runtime.state);
    if (!transitions.length) return;

    const snapshot = this.snapshot();
    let best: { time: Time; transition: Transition<any>; index: number; detail: TransitionDetail } | null = null;
    const machineMods = this.modifiers.get(machineId);

    transitions.forEach((transition, index) => {
      const localRng = this.baseRng.child(`${machineId}:v${version}:t${index}`);
      const baseRate = transition.hazard(snapshot, this.now, localRng);
      if (!(baseRate > 0)) return;
      let lambda = baseRate;
      const applied: Array<{ id: string; after: number }> = [];
      if (machineMods) {
        for (const [id, entry] of machineMods.entries()) {
          lambda = entry.apply(lambda, snapshot, this.now);
          if (!(lambda > 0)) {
            applied.push({ id, after: 0 });
            lambda = 0;
            break;
          }
          applied.push({ id, after: lambda });
        }
      }
      if (!(lambda > 0)) return;
      const delta = localRng.expo(lambda);
      if (!Number.isFinite(delta)) return;
      const eventTime = this.now + delta;
      if (!best || eventTime < best.time) {
        best = {
          time: eventTime,
          transition,
          index,
          detail: {
            baseRate,
            finalRate: lambda,
            explanation: transition.hazard.explain?.(snapshot, this.now),
            modifiers: applied
          }
        };
      }
    });

    if (best) {
      this.enqueue({
        kind: 'transition',
        time: best.time,
        machineId,
        transitionIndex: best.index,
        version,
        detail: best.detail
      });
    }
  }

  dispatchWatchers(event: ClinicalEvent, ctx: KernelCtx) {
    for (const watcher of this.watchers) {
      try {
        if (watcher.match(event)) {
          const effects = watcher.react(event, ctx) ?? [];
          if (effects.length) this.applyEffects(effects, ctx);
        }
      } catch (err) {
        this.logger?.(`watcher ${watcher.id} failed: ${String((err as Error).message ?? err)}`);
      }
    }
  }

  applyEffects(effects: Effect[], ctx: KernelCtx) {
    const queue: Effect[] = [...effects];
    while (queue.length) {
      const effect = queue.shift()!;
      switch (effect.type) {
        case 'emit': {
          this.appendEvent(effect.event);
          this.dispatchWatchers(effect.event, ctx);
          break;
        }
        case 'setAttr': {
          this.setAttr(effect.key, effect.value);
          break;
        }
        case 'setDisease': {
          this.setDisease(effect.disease, effect.state);
          break;
        }
        case 'modifyHazard': {
          const token = this.addModifier(effect.process, effect.modifierId, effect.apply);
          if (effect.until != null && Number.isFinite(effect.until)) {
            this.enqueue({
              kind: 'thunk',
              time: effect.until,
              thunk: (tctx) => {
                this.removeModifier(effect.process, effect.modifierId, token);
                return [];
              }
            });
          }
          break;
        }
        case 'schedule': {
          const at = Math.max(effect.at, this.now);
          this.enqueue({ kind: 'thunk', time: at, thunk: effect.thunk });
          break;
        }
      }
    }
  }

  run(): { events: ClinicalEvent[]; snapshot: Snapshot } {
    for (const machineId of this.machines.keys()) {
      this.scheduleMachine(machineId);
    }

    const ctx = new KernelCtx(this);

    while (this.queueLength()) {
      const item = this.nextItem();
      if (!item) break;
      if (item.time > this.horizon) break;
      this.advanceTo(item.time);

      if (item.kind === 'transition') {
        const runtime = this.runtimes.get(item.machineId);
        if (!runtime || item.version !== runtime.version) {
          continue;
        }
        const machine = this.machines.get(item.machineId);
        if (!machine) continue;
        const transition = machine.transitions[item.transitionIndex];
        if (!transition || transition.from !== runtime.state) continue;

        runtime.state = transition.to;
        runtime.version += 1;
        this.diseases = { ...this.diseases, [machine.id]: transition.to };

        if (this.explain) this.printTransitionExplain(machine.id, transition, item.detail);

        if (transition.onFire) {
          try {
            const effects = transition.onFire(ctx) ?? [];
            if (effects.length) this.applyEffects(effects, ctx);
          } catch (err) {
            this.logger?.(`transition ${machine.id}:${transition.from}->${transition.to} failed: ${String((err as Error).message ?? err)}`);
          }
        }

        this.scheduleMachine(machine.id);
      } else {
        try {
          const effects = item.thunk(ctx) ?? [];
          if (effects.length) this.applyEffects(effects, ctx);
        } catch (err) {
          this.logger?.(`thunk execution failed: ${String((err as Error).message ?? err)}`);
        }
      }
    }

    return { events: this.getEvents(), snapshot: this.snapshot() };
  }

  private printTransitionExplain(machineId: string, transition: Transition<any>, detail: TransitionDetail) {
    const rate = detail.finalRate;
    const base = detail.baseRate;
    const header = `${this.pid} :: ${machineId} ${transition.from}→${transition.to} @ t=${this.now.toFixed(2)}d λ=${rate.toExponential(3)}`;
    if (this.logger) this.logger(header);
    else console.log(header);
    if (detail.explanation) {
      const prefix = detail.explanation.scale === 'log-linear' ? 'log-rate' : 'rate';
      for (const term of detail.explanation.terms) {
        const line = `  ${prefix} +${term.label}: ${term.value.toFixed(4)}`;
        if (this.logger) this.logger(line);
        else console.log(line);
      }
      const line = `  => base λ=${base.toExponential(3)}`;
      if (this.logger) this.logger(line);
      else console.log(line);
    }
    if (detail.modifiers.length) {
      for (const mod of detail.modifiers) {
        const line = `  modifier ${mod.id} ⇒ λ=${mod.after.toExponential(3)}`;
        if (this.logger) this.logger(line);
        else console.log(line);
      }
    }
  }
}

export function runKernel(opts: KernelOptions) {
  const state = new KernelState(opts);
  return state.run();
}
