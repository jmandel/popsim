import type { DiseaseModule } from "../../src/contracts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const module: DiseaseModule = {
  id: "Type2DiabetesMellitus",
  version: "1.0.0",
  summary: "Progressive type 2 diabetes model with labs, medications, and complication surveillance.",
  init(p, ctx) {
    const baselineA1c = typeof p.attributes.HBA1C === "number" ? (p.attributes.HBA1C as number) : 5.6;
    ctx.set("t2dm_a1c", baselineA1c);
    ctx.set("t2dm_med_adherence", 0);
    ctx.set("t2dm_next_lab", ctx.now + 0.75);
    ctx.set("t2dm_next_eye", ctx.now + 1.2);
  },
  eligible(p) {
    const age = (p.attributes.AGE_YEARS as number) ?? 0;
    return age >= 30;
  },
  risk(p, ctx) {
    const bmi = (p.attributes.BMI as number) ?? 26;
    const glucose = (p.attributes.FASTING_GLUCOSE as number) ?? 95;
    const fhx = p.attributes.FAMILY_HISTORY_DIABETES ? 1 : 0;
    const stress = ctx.get("stressIndex") ?? 0.3;
    const activity = ctx.get("activityScore") ?? 5;
    const diet = ctx.get("dietScore") ?? 55;
    const obesityLoad = clamp((bmi - 32) / 12, 0, 1);
    const glycemicLoad = clamp((glucose - 115) / 120, 0, 1);
    const lifestyleLift = Math.max(0, 70 - diet) * 0.0004 + Math.max(0, 6 - activity) * 0.001;
    const base =
      0.0015 +
      obesityLoad * 0.012 +
      glycemicLoad * 0.014 +
      fhx * 0.006 +
      stress * 0.004 +
      lifestyleLift;
    const protective = Math.max(0, diet - 75) * 0.0007 + Math.max(0, activity - 7) * 0.0015;
    return clamp(base - protective, 0.0005, 0.08);
  },
  step(p, ctx) {
    const diagnosed = !!p.diagnoses["E11.9"];
    const monthlyRisk = this.risk(p, ctx) / 12;
    const bmi = (p.attributes.BMI as number) ?? 26;
    const diet = ctx.get("dietScore") ?? 55;
    const activity = ctx.get("activityScore") ?? 5;
    const stress = ctx.get("stressIndex") ?? 0.3;

    if (!diagnosed && ctx.rngUniform() < monthlyRisk) {
      ctx.emit({ type: "diagnosis", payload: { code: "E11.9", name: "Type 2 diabetes mellitus without complications" } });
      p.diagnoses["E11.9"] = 1;
      const adherence =
        0.55 +
        ctx.rngUniform() * 0.35 +
        ((ctx.get("preventiveAdherence") ?? 0.2) * 0.2);
      ctx.set("t2dm_med_adherence", clamp(adherence, 0.4, 0.95));
      ctx.set("t2dm_a1c", clamp(((p.attributes.HBA1C as number) ?? 6.8) + 0.2, 6.4, 9.2));
      ctx.emit({ type: "lab", payload: { id: "A1C", name: "Hemoglobin A1c", value: Number(((p.attributes.HBA1C as number) ?? 6.9 + 0.2).toFixed(1)) } });
      const baselineGlucose = (p.attributes.FASTING_GLUCOSE as number) ?? 150;
      ctx.emit({ type: "lab", payload: { id: "FPG", name: "Fasting plasma glucose", value: Math.round(clamp(baselineGlucose + 5, 110, 260)) } });
      const startMetforminProb = 0.88 + Math.min(0.08, ((ctx.get("preventiveAdherence") ?? 0.2) - 0.3) * 0.4);
      const startMetformin = ctx.rngUniform() < Math.min(0.96, Math.max(0.72, startMetforminProb));
      if (!p.medsOn["Metformin"] && (p.attributes.EGFR as number) > 30 && startMetformin) {
        ctx.emit({ type: "medication", payload: { drug: "Metformin", dose: "500 mg twice daily" } });
        p.medsOn["Metformin"] = 1;
      }
      ctx.set("t2dm_next_lab", ctx.now + 0.33);
      ctx.schedule(0.5, { type: "procedure", payload: { code: "2022F", name: "Dilated retinal exam" } });
    }

    let a1c = ctx.get("t2dm_a1c") ?? ((p.attributes.HBA1C as number) ?? 5.6);
    const adherence = ctx.get("t2dm_med_adherence") ?? 0;
    const riskSignal = this.risk(p, ctx);
    const baselineTarget = clamp(5.8 + riskSignal * 0.6 + stress * 0.2 - activity * 0.03, 5.6, 7.4);
    const treatedTarget = clamp(7.2 + (1 - adherence) * 1.4 + stress * 0.35 + (diet < 60 ? 0.5 : 0), 6.6, 9);
    const target = diagnosed ? treatedTarget : baselineTarget;
    a1c = clamp(a1c + (target - a1c) * 0.2 + ctx.rngNormal(0, 0.05), diagnosed ? 6 : 5.7, diagnosed ? 9.4 : 7.6);
    ctx.set("t2dm_a1c", Number(a1c.toFixed(1)));

    if (diagnosed && !p.medsOn["GLP-1 RA"] && a1c > 7.8 && ctx.rngUniform() < 0.1) {
      ctx.emit({ type: "medication", payload: { drug: "Semaglutide", dose: "0.5 mg weekly" } });
      p.medsOn["GLP-1 RA"] = 1;
      ctx.set("t2dm_med_adherence", clamp((ctx.get("t2dm_med_adherence") ?? 0.6) + 0.1, 0.4, 0.95));
    }

    if (diagnosed && !p.medsOn["ACE Inhibitor"] && ((p.attributes.SYSTOLIC_BP as number) ?? 120) > 135) {
      ctx.emit({ type: "medication", payload: { drug: "Lisinopril", dose: "10 mg daily" } });
      p.medsOn["ACE Inhibitor"] = 1;
      ctx.set("ckd_bp_control", (ctx.get("ckd_bp_control") ?? 0) + 0.4);
    }

    const nextLabDue = ctx.get("t2dm_next_lab") ?? (ctx.now + 0.75);
    if (ctx.now >= nextLabDue - 1e-6) {
      const labA1c = clamp(a1c + ctx.rngNormal(0, 0.1), 5.2, 9.5);
      const glucose = clamp(18 * labA1c + 60 + ctx.rngNormal(0, 10), 85, 250);
      ctx.emit({ type: "lab", payload: { id: "A1C", name: "Hemoglobin A1c", value: Number(labA1c.toFixed(1)) } });
      ctx.emit({ type: "lab", payload: { id: "FPG", name: "Fasting plasma glucose", value: Math.round(glucose) } });
      ctx.set("t2dm_next_lab", ctx.now + (a1c > 7.8 ? 0.33 : 0.5));
    }

    const nextEye = ctx.get("t2dm_next_eye") ?? (ctx.now + 1.2);
    if (ctx.now >= nextEye - 1e-6 && diagnosed) {
      ctx.emit({ type: "procedure", payload: { code: "92250", name: "Annual retinal photography" } });
      ctx.set("t2dm_next_eye", ctx.now + 1);
    }
  },
  invariants() {
    return [
      { name: "Eligible adults", expr: "AGE_YEARS >= 30" },
      { name: "Metformin requires kidneys", expr: "EGFR > 20" }
    ];
  },
  test() {
    const patient: any = {
      attributes: {
        AGE_YEARS: 55,
        BMI: 34,
        FASTING_GLUCOSE: 160,
        HBA1C: 7.8,
        FAMILY_HISTORY_DIABETES: true,
        EGFR: 75,
        SYSTOLIC_BP: 142
      },
      diagnoses: {},
      medsOn: {},
      signals: { activityScore: 3, dietScore: 45, stressIndex: 0.4 }
    };
    const events: any[] = [];
    const ctx: any = {
      now: 40,
      rngUniform: () => 0.0,
      rngNormal: () => 0,
      emit: (e: any) => events.push(e),
      schedule: () => {},
      get: (k: string) => patient.signals[k],
      set: (k: string, v: number) => { patient.signals[k] = v; }
    };
    this.init!(patient, ctx);
    this.step(patient, ctx);
    return { passed: events.some((e) => e.type === "diagnosis") };
  }
};

export default module;
