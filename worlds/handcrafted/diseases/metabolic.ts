import type { DiseaseModule } from "../../src/contracts";

const module: DiseaseModule = {
  id: "MetabolicSyndrome",
  version: "1.0.0",
  summary: "Simplified metabolic syndrome progression driven by BMI and blood pressure.",
  init(p, ctx) {
    const baseline = ((p.attributes.BMI as number) ?? 24) - 24;
    ctx.set("metabolic_risk", Math.max(0, baseline));
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
    const risk = this.risk(p, ctx);
    if (!p.diagnoses["E88.81"] && ctx.rngUniform() < risk / 12) {
      ctx.emit({ type: "diagnosis", payload: { code: "E88.81", name: "Metabolic syndrome" } });
      ctx.set("metabolic_risk", (ctx.get("metabolic_risk") ?? 0) + 1);
    }
    if (ctx.rngUniform() < 0.25) {
      const bmi = (p.attributes.BMI as number) ?? 24;
      const labDrift = bmi > 30 ? 1.2 : 0.4;
      const baseA1c = 5.4 + Math.max(0, (bmi - 25) * 0.1);
      const fluctuation = ctx.rngNormal(0, labDrift * 0.1);
      ctx.emit({
        type: "lab",
        payload: {
          id: "A1C",
          name: "Hemoglobin A1c",
          value: Number((baseA1c + fluctuation).toFixed(1)),
          unit: "%"
        }
      });
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
      now: 0,
      emit: (e: any) => logs.push(e),
      set: () => {},
      get: () => 1
    };
    this.step(dummyPatient, ctx);
    return { passed: logs.length > 0 };
  }
};

export default module;
