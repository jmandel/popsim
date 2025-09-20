import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { WorldFile, PatientSnapshot, SimContext, Event, AttrValue, AttrLimits } from "./contracts";

class RNG {
  private state: number;
  constructor(seed=42){ this.state = seed>>>0; }
  next(){ let x=this.state; x^=x<<13; x^=x>>>17; x^=x<<5; this.state=x>>>0; return this.state/0xffffffff; }
  uniform(a=0,b=1){ return a + (b-a)*this.next(); }
  normal(mean=0, sd=1){ const u=this.next()||1e-9, v=this.next()||1e-9;
    const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); return mean+sd*z; }
}
class PQ<T>{ data:{t:number;item:T}[]=[]; push(t:number,item:T){const r={t,item}; let lo=0,hi=this.data.length;
  while(lo<hi){ const mid=(lo+hi)>>>1; if(this.data[mid].t<=t) lo=mid+1; else hi=mid; } this.data.splice(lo,0,r);} 
  pop(){ const entry = this.data.shift(); return entry ? entry.item : undefined; } get length(){return this.data.length;} }

type PendingEv = { t: number; e: Omit<Event, "t"> };
type DiseaseRuntime = { id: string; mod: any };

function clampVal(v: any, lim?: AttrLimits): any {
  if (typeof v !== "number" || !lim) return v;
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  if (lim.min != null && v < lim.min) return lim.min;
  if (lim.max != null && v > lim.max) return lim.max;
  return v;
}

export type SimulationOptions = {
  n: number;
  world: WorldFile;
  llmRuntime?: boolean;
};

export async function runSimulation(opts: SimulationOptions) {
  const rng = new RNG(opts.world.seed);
  const out: any[] = [];

  // Limits
  let limits: Record<string, AttrLimits> = {};
  if (opts.world.attributeCatalogPath) {
    try {
      const cat = await Bun.file(opts.world.attributeCatalogPath).json() as { catalog: Array<{ key: string; limits?: AttrLimits }>};
      for (const c of cat.catalog) if (c.limits) limits[c.key] = c.limits;
    } catch {}
  }

  // Load modules
  const attrMods = [];
  for (const am of opts.world.attributeModules) {
    const mod = (await import("file://" + resolve(am.path))).default;
    attrMods.push(mod);
  }
  const diseaseMods: DiseaseRuntime[] = [];
  for (const dm of opts.world.diseaseModules) {
    const mod = (await import("file://" + resolve(dm.path))).default;
    diseaseMods.push({ id: dm.id, mod });
  }

  for (let i=0;i<opts.n;i++){
    const pid = "P"+String(i+1);
    const birthYear = 1940 + Math.floor(rng.uniform()*60);
    const prng = new RNG((opts.world.seed + i*7919)>>>0);
    const signals: Record<string, number> = {};
    const attributes: Record<string, AttrValue> = {};
    let sexAtBirth: "M"|"F"|"U" = "U";

    // Generate attributes
    for (const m of attrMods) {
      const g = m.generate(prng.next()*1e9|0, birthYear);
      for (const [k, spec] of Object.entries<any>(g.attributes)) {
        const lim = spec.limits;
        if (lim) limits[k] = limits[k] ?? lim;
        attributes[k] = clampVal(spec.value, limits[k]);
      }
      if (g.signals) Object.assign(signals, g.signals);
      if (g.sexAtBirth && sexAtBirth==="U") sexAtBirth = g.sexAtBirth;
    }
    const startAge = typeof attributes["AGE_YEARS"] === "number" ? (attributes["AGE_YEARS"] as number) : 18;
    attributes["AGE_YEARS"] = startAge;
    if (!("SEX_AT_BIRTH" in attributes)) attributes["SEX_AT_BIRTH"] = sexAtBirth;

    const patient: PatientSnapshot = {
      id: pid, birthYear, ageYears: startAge,
      sexAtBirth: (attributes["SEX_AT_BIRTH"] as any) ?? "U",
      attributes, signals, diagnoses: {}, medsOn: {},
      rngSeed: prng.next()*1e9|0
    };

    const events: Event[] = [];
    const Q = new PQ<PendingEv>();
    const y2t = (y:number)=>y;
    const ctx: SimContext = {
      now: startAge, y2t,
      rngUniform: ()=>prng.uniform(),
      rngNormal: (m=0,s=1)=>prng.normal(m,s),
      emit: (e:Event)=>{
        const ev = { ...e, t: ctx.now } as Event;
        events.push(ev);
        if (ev.type === "diagnosis") patient.diagnoses[ev.payload.code] = 1;
        if (ev.type === "medication") patient.medsOn[ev.payload.drug] = 1;
      },
      schedule: (delayYears:number, e:Omit<Event, "t">)=>{
        const delay = Math.max(0, delayYears);
        const target = ctx.now + delay;
        Q.push(target, { t: target, e });
      },
      get: (k:string)=>patient.signals[k],
      set: (k:string,v:number)=>{ patient.signals[k]=v; },
      attr: (id:string)=>patient.attributes[id],
      setAttr: (id:string,v:any)=>{ patient.attributes[id]= clampVal(v, limits[id]); },
      log: (_:string)=>{}
    };

    // Routine encounters & death
    const maxAge = 115;
    const scheduleEncounterSeries = (beginAge: number, meanMonths: number) => {
      const horizon = Math.min(maxAge, startAge + 35);
      let next = Math.max(beginAge, startAge + 0.25);
      while (next < horizon) {
        Q.push(next, { t: next, e: { type: "encounter", payload: { kind: "PCP" } } });
        const jitter = (prng.uniform() - 0.5) * 0.25; // +/- 3 months jitter
        const stepYears = Math.max(0.5, meanMonths / 12 + jitter);
        next += stepYears;
      }
    };
    const youngCadence = startAge < 40 ? 14 : 18;
    const seniorCadence = startAge >= 65 ? 10 : youngCadence;
    scheduleEncounterSeries(startAge + prng.uniform(), seniorCadence);

    const sampleDeathAge = () => {
      const skipChance = Math.min(0.5, Math.max(0.15, 0.36 - Math.max(0, startAge - 35) * 0.0035));
      if (prng.uniform() < skipChance) return Number.POSITIVE_INFINITY;
      const mean = 88;
      const scale = 10;
      for (let attempt = 0; attempt < 8; attempt++) {
        const u = prng.uniform();
        if (u <= 0 || u >= 1) continue;
        const draw = mean + scale * Math.log(u / (1 - u));
        if (draw > startAge + 0.75 && draw < maxAge) return draw;
      }
      return Number.POSITIVE_INFINITY;
    };
    const deathAge = sampleDeathAge();
    if (Number.isFinite(deathAge)) {
      Q.push(deathAge, { t: deathAge, e: { type: "death", payload: {} } });
    }

    // Init diseases
    for (const D of diseaseMods) if (typeof D.mod.init === "function") D.mod.init(patient, ctx);

    // Eligibility cache
    let eCache: Record<string, boolean> = {};
    const recomputeEligibility = () => {
      eCache = {}; for (const D of diseaseMods) {
        try { eCache[D.id] = !!D.mod.eligible(patient); } catch { eCache[D.id] = false; }
      }
    };
    recomputeEligibility();

    // Sim loop
    let lastT = startAge;
    while (Q.length){
      const { t, e } = Q.pop()!;
      const months = Math.max(0, Math.floor((t - lastT)*12));
      for (let m=0;m<months;m++){
        patient.ageYears = lastT + (m+1)/12;
        patient.attributes["AGE_YEARS"] = patient.ageYears;
        ctx.now = patient.ageYears;
        for (const mod of attrMods) if (typeof mod.update === "function") { try { mod.update(patient, ctx, 1/12); } catch {} }
        recomputeEligibility();
        for (const D of diseaseMods) if (eCache[D.id]) { try { D.mod.step(patient, ctx); } catch {} }
      }
      lastT = t; patient.ageYears = t; patient.attributes["AGE_YEARS"] = patient.ageYears; ctx.now = t;
      patient.signals["core_lastEventAge"] = t;
      if (e.type === "encounter") patient.signals["core_lastEncounterAge"] = t;
      if (e.type === "death") patient.signals["core_deathAge"] = t;
      events.push({ ...e, t });
      if (e.type === "death") break;
      if (e.type === "encounter") for (const D of diseaseMods) if (eCache[D.id]) { try { D.mod.step(patient, ctx); } catch {} }
    }

    for (const ev of events) if (ev.type === "diagnosis") patient.diagnoses[ev.payload.code] = 1;
    out.push({ id: pid, birthYear, attrs: patient.attributes, signals: patient.signals, events });
  }

  const totalEvents = out.reduce((a:any,p:any)=>a+p.events.length,0);
  const avgEvents = totalEvents / Math.max(1,out.length);
  const deathFrac = out.filter((p:any)=>p.events.some((e:any)=>e.type==="death")).length / Math.max(1,out.length);
  const dxCount = out.reduce((a:any,p:any)=>a+p.events.filter((e:any)=>e.type==="diagnosis").length,0);
  const metrics = { patients: out.length, avgEventsPerPatient: avgEvents, diagnosisEvents: dxCount, deathFraction: deathFrac };
  await mkdir("out/sim", { recursive: true });
  await Bun.write("out/sim/summary.json", JSON.stringify(metrics, null, 2));

  return out;
}
