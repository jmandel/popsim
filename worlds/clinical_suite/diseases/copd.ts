import type { DiseaseModule } from "../../src/contracts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const module: DiseaseModule = {
  id: "ChronicObstructivePulmonaryDisease",
  version: "1.0.0",
  summary: "COPD progression with spirometry surveillance, exacerbations, and inhaler management.",
  init(p, ctx) {
    const baseline = (p.attributes.RESPIRATORY_CAPACITY as number) ?? 90;
    ctx.set("copd_baseline", baseline);
    ctx.set("copd_next_spirometry", ctx.now + 1.1);
    ctx.set("copd_exacerbation_rate", 0.02);
  },
  eligible(p) {
    const age = (p.attributes.AGE_YEARS as number) ?? 0;
    const packYears = (p.attributes.SMOKING_PACK_YEARS as number) ?? 0;
    const exposure = !!p.attributes.OCCUPATIONAL_EXPOSURE_DUST;
    return age >= 40 && (packYears > 5 || exposure);
  },
  risk(p, ctx) {
    const packYears = (p.attributes.SMOKING_PACK_YEARS as number) ?? (ctx.get("smokingPackYears") ?? 0);
    const capacity = ctx.get("pulmonary_capacity") ?? ((p.attributes.RESPIRATORY_CAPACITY as number) ?? 90);
    const exposure = p.attributes.OCCUPATIONAL_EXPOSURE_DUST ? 1 : 0;
    const base = 0.008 + packYears * 0.0018 + exposure * 0.02 + clamp((80 - capacity) * 0.002, 0, 0.2);
    return clamp(base, 0.001, 0.35);
  },
  step(p, ctx) {
    const diagnosed = !!p.diagnoses["J44.9"];
    const monthlyRisk = this.risk(p, ctx) / 12;
    const capacity = ctx.get("pulmonary_capacity") ?? ((p.attributes.RESPIRATORY_CAPACITY as number) ?? 90);

    if (!diagnosed && ctx.rngUniform() < monthlyRisk) {
      ctx.emit({ type: "diagnosis", payload: { code: "J44.9", name: "Chronic obstructive pulmonary disease" } });
      p.diagnoses["J44.9"] = 1;
      ctx.emit({ type: "lab", payload: { id: "SPIRO_FEV1", name: "Spirometry FEV1 % predicted", value: Math.round(capacity) } });
      if (!p.medsOn["LAMA"]) {
        ctx.emit({ type: "medication", payload: { drug: "Tiotropium inhaler", dose: "18 mcg daily" } });
        p.medsOn["LAMA"] = 1;
      }
      ctx.emit({ type: "medication", payload: { drug: "Albuterol inhaler", dose: "2 puffs q4h PRN" } });
      p.medsOn["SABA"] = 1;
      ctx.set("copd_next_spirometry", ctx.now + 0.75);
      ctx.set("copd_exacerbation_rate", 0.04);
    }

    const exacerbationRate = ctx.get("copd_exacerbation_rate") ?? 0.02;
    const severity = clamp(1 - capacity / 100, 0, 0.9);
    const exacerbationProb = clamp(exacerbationRate + severity * 0.08, 0.005, 0.18);
    if (diagnosed && ctx.rngUniform() < exacerbationProb) {
      const severe = ctx.rngUniform() < 0.35 || capacity < 45;
      ctx.emit({ type: "encounter", payload: { kind: severe ? "Inpatient" : "ED" } });
      ctx.emit({ type: "procedure", payload: { code: "94640", name: "Nebulizer treatment" } });
      ctx.emit({ type: "medication", payload: { drug: "Prednisone", dose: "40 mg taper" } });
      ctx.set("copd_exacerbation_rate", clamp(exacerbationRate + 0.008, 0.02, 0.12));
      if (!p.medsOn["Inhaled corticosteroid"] && (severity > 0.3 || ctx.rngUniform() < 0.3)) {
        ctx.emit({ type: "medication", payload: { drug: "Budesonide-formoterol", dose: "160/4.5 mcg BID" } });
        p.medsOn["Inhaled corticosteroid"] = 1;
      }
      if (severe && !p.medsOn["Home oxygen"] && capacity < 45 && ctx.rngUniform() < 0.3) {
        ctx.emit({ type: "medication", payload: { drug: "Home oxygen", dose: "2 L/min" } });
        p.medsOn["Home oxygen"] = 1;
      }
    }

    const nextSpirometry = ctx.get("copd_next_spirometry") ?? (ctx.now + 1);
    if (ctx.now >= nextSpirometry - 1e-6 && (diagnosed || capacity < 65)) {
      const value = clamp(capacity + ctx.rngNormal(0, 4), 30, 110);
      ctx.emit({ type: "lab", payload: { id: "SPIRO_FEV1", name: "Spirometry FEV1 % predicted", value: Math.round(value) } });
      ctx.set("copd_next_spirometry", ctx.now + 1);
    }

    if (!diagnosed && (p.attributes.SMOKING_STATUS === "Current") && ctx.rngUniform() < 0.02) {
      ctx.emit({ type: "procedure", payload: { code: "71250", name: "Low-dose CT lung cancer screening" } });
    }
  },
  test() {
    const patient: any = {
      attributes: {
        AGE_YEARS: 64,
        SMOKING_PACK_YEARS: 45,
        RESPIRATORY_CAPACITY: 55,
        OCCUPATIONAL_EXPOSURE_DUST: true
      },
      diagnoses: {},
      medsOn: {},
      signals: { pulmonary_capacity: 55 }
    };
    const events: any[] = [];
    const ctx: any = {
      now: 50,
      rngUniform: () => 0,
      rngNormal: () => 0,
      emit: (e: any) => events.push(e),
      schedule: () => {},
      get: (k: string) => patient.signals[k],
      set: (k: string, v: number) => {
        patient.signals[k] = v;
      }
    };
    this.init!(patient, ctx);
    this.step(patient, ctx);
    return { passed: events.some((e) => e.type === "diagnosis") };
  }
};

export default module;
