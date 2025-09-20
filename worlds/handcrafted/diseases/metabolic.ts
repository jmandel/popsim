import type { DiseaseModule } from "../../src/contracts";

const module: DiseaseModule = {
  id: "MetabolicSyndrome",
  version: "1.0.0",
  summary: "Simplified metabolic syndrome progression driven by BMI and blood pressure.",
  init(p, ctx) {
    const baseline = ((p.attributes.BMI as number) ?? 24) - 24;
    ctx.set("metabolic_risk", Math.max(0, baseline));
    ctx.set("metabolic_last_lab_age", ctx.now - 2);
    ctx.set("metabolic_last_dx_eval", ctx.now - 1);
  },
  eligible(p) {
    return typeof p.attributes.BMI === "number" && (p.attributes.AGE_YEARS as number) >= 18;
  },
  risk(p, ctx) {
    const bmi = (p.attributes.BMI as number) ?? 24;
    const pressure = ((p.attributes.SYSTOLIC_BP as number) ?? 118) - 120;
    const base = 0.05 + Math.max(0, (bmi - 27) * 0.01) + Math.max(0, pressure) * 0.001;
    return Math.min(0.5, base + (ctx.get("metabolic_risk") ?? 0) * 0.02);
  },
  step(p, ctx) {
    const now = ctx.now;
    const lastEncounter = ctx.get("core_lastEncounterAge");
    const monthsSinceEncounter = lastEncounter != null ? (now - lastEncounter) * 12 : Infinity;

    const lastLab = ctx.get("metabolic_last_lab_age");
    const monthsSinceLab = lastLab != null ? (now - lastLab) * 12 : Infinity;
    const bmi = (p.attributes.BMI as number) ?? 24;
    const labIntervalMonths = (p.diagnoses["E88.81"] ? 6 : 9) + Math.max(0, (30 - bmi));

    const engagedInCare = monthsSinceEncounter <= 3;
    if (engagedInCare && monthsSinceLab >= labIntervalMonths) {
      const baseA1c = 5.2 + Math.max(0, (bmi - 25) * 0.12);
      const variability = bmi >= 30 ? 0.3 : 0.18;
      const measurement = Number((baseA1c + ctx.rngNormal(0, variability)).toFixed(1));
      ctx.emit({
        type: "lab",
        payload: {
          id: "A1C",
          name: "Hemoglobin A1c",
          value: measurement,
          unit: "%"
        }
      });
      ctx.set("metabolic_last_lab_age", now);
    }

    const lastEval = ctx.get("metabolic_last_dx_eval");
    const monthsSinceEval = lastEval != null ? (now - lastEval) * 12 : Infinity;
    if (!p.diagnoses["E88.81"] && monthsSinceEval >= 12 && monthsSinceEncounter <= 12) {
      ctx.set("metabolic_last_dx_eval", now);
      const annualRisk = Math.min(0.35, this.risk(p, ctx));
      if (ctx.rngUniform() < annualRisk) {
        ctx.emit({ type: "diagnosis", payload: { code: "E88.81", name: "Metabolic syndrome" } });
        ctx.set("metabolic_risk", (ctx.get("metabolic_risk") ?? 0) + 1.5);
      }
    }
  },
  invariants() {
    return [
      { name: "BMI present", expr: "BMI != null" },
      { name: "Blood pressure positive", expr: "SYSTOLIC_BP > DIASTOLIC_BP" }
    ];
  },
  test() {
    const dummyPatient: any = {
      attributes: { BMI: 32, AGE_YEARS: 50, SYSTOLIC_BP: 138, DIASTOLIC_BP: 82 },
      diagnoses: {},
      signals: {}
    };
    const logs: any[] = [];
    const ctx: any = {
      rngUniform: () => 0.01,
      rngNormal: () => 0,
      now: 50,
      emit: (e: any) => logs.push(e),
      set: () => {},
      get: (key: string) => {
        if (key === "core_lastEncounterAge") return 49.9;
        if (key === "metabolic_last_lab_age") return 48;
        if (key === "metabolic_last_dx_eval") return 48;
        return 1;
      }
    };
    this.step(dummyPatient, ctx);
    const hasLab = logs.some((e: any) => e.type === "lab");
    return { passed: hasLab };
  }
};

export default module;
