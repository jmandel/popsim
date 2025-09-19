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
  pop(){return this.data.shift();} get length(){return this.data.length;} }

type PendingEv = { t: number; e: Event };
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
    const mod = (await import("file://" + Bun.cwd() + "/" + am.path)).default;
    attrMods.push(mod);
  }
  const diseaseMods: DiseaseRuntime[] = [];
  for (const dm of opts.world.diseaseModules) {
    const mod = (await import("file://" + Bun.cwd() + "/" + dm.path)).default;
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
    if (attributes["AGE_YEARS"] == null) attributes["AGE_YEARS"] = 18;
    if (!("SEX_AT_BIRTH" in attributes)) attributes["SEX_AT_BIRTH"] = sexAtBirth;

    const patient: PatientSnapshot = {
      id: pid, birthYear, ageYears: 0,
      sexAtBirth: (attributes["SEX_AT_BIRTH"] as any) ?? "U",
      attributes, signals, diagnoses: {}, medsOn: {},
      rngSeed: prng.next()*1e9|0
    };

    const events: Event[] = [];
    const Q = new PQ<PendingEv>();
    const y2t = (y:number)=>y;
    const ctx: SimContext = {
      now: 0, y2t,
      rngUniform: ()=>prng.uniform(),
      rngNormal: (m=0,s=1)=>prng.normal(m,s),
      emit: (e:Event)=>{ events.push({ ...e, t: ctx.now }); },
      schedule: (delayYears:number, e:Event)=>{ Q.push(ctx.now+delayYears, { t: ctx.now+delayYears, e }); },
      get: (k:string)=>patient.signals[k],
      set: (k:string,v:number)=>{ patient.signals[k]=v; },
      attr: (id:string)=>patient.attributes[id],
      setAttr: (id:string,v:any)=>{ patient.attributes[id]= clampVal(v, limits[id]); },
      log: (_:string)=>{}
    };

    // Routine encounters & death
    for (let y=18;y<95;){ const step=0.6+prng.uniform()*0.6; y+=step; Q.push(y,{t:y,e:{t:y,type:"encounter",payload:{kind:"PCP"}}}); }
    const death = -Math.log(1-prng.uniform()) / 0.02; if (death < 105) Q.push(death,{t:death,e:{t:death,type:"death",payload:{}}});

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
    let lastT = 0;
    while (Q.length){
      const { t, e } = Q.pop()!;
      const months = Math.max(0, Math.floor((t - lastT)*12));
      for (let m=0;m<months;m++){
        patient.ageYears = lastT + (m+1)/12; ctx.now = patient.ageYears;
        for (const mod of attrMods) if (typeof mod.update === "function") { try { mod.update(patient, ctx, 1/12); } catch {} }
        recomputeEligibility();
        for (const D of diseaseMods) if (eCache[D.id]) { try { D.mod.step(patient, ctx); } catch {} }
      }
      lastT = t; patient.ageYears = t; ctx.now = t;
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
  await Bun.write("out/sim/summary.json", JSON.stringify(metrics, null, 2));

  return out;
}
