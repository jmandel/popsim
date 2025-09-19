import type { DiseaseModule } from "../../src/contracts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stageFromEgfr(egfr: number): number {
  if (egfr >= 60) return 2;
  if (egfr >= 45) return 3;
  if (egfr >= 30) return 3.5;
  if (egfr >= 15) return 4;
  return 5;
}

const module: DiseaseModule = {
  id: "ChronicKidneyDisease",
  version: "1.0.0",
  summary: "Chronic kidney disease progression with albuminuria monitoring and renoprotective therapy.",
  init(p, ctx) {
    const egfr = (p.attributes.EGFR as number) ?? 85;
    ctx.set("ckd_stage", stageFromEgfr(egfr));
    ctx.set("ckd_next_lab", ctx.now + 0.6);
    ctx.set("ckd_ultrasound_done", 0);
    ctx.set("ckd_bp_control", ctx.get("ckd_bp_control") ?? 0);
  },
  eligible(p) {
    const age = (p.attributes.AGE_YEARS as number) ?? 0;
    const egfr = (p.attributes.EGFR as number) ?? 90;
    const albumin = (p.attributes.URINE_ALBUMIN as number) ?? 15;
    return age >= 35 && (egfr < 90 || albumin > 30 || p.diagnoses["E11.9"] || ((p.attributes.SYSTOLIC_BP as number) ?? 0) > 140);
  },
  risk(p, ctx) {
    const egfr = (p.attributes.EGFR as number) ?? 95;
    const albumin = (p.attributes.URINE_ALBUMIN as number) ?? 10;
    const diabetes = p.diagnoses["E11.9"] ? 1 : 0;
    const bp = (p.attributes.SYSTOLIC_BP as number) ?? 120;
    const egfrLoad = clamp((75 - egfr) * 0.002, 0, 0.12);
    const albuminLoad = clamp((albumin - 80) * 0.0004, 0, 0.06);
    const bpLoad = Math.max(0, bp - 140) * 0.00035;
    const base = 0.0015 + egfrLoad + albuminLoad + diabetes * 0.011 + bpLoad;
    return clamp(base, 0.0005, 0.25);
  },
  step(p, ctx) {
    const diagnosed = !!p.diagnoses["N18.3"] || !!p.diagnoses["N18.4"] || !!p.diagnoses["N18.5"];
    const monthlyRisk = this.risk(p, ctx) / 12;
    const egfr = (p.attributes.EGFR as number) ?? 90;
    const stage = stageFromEgfr(egfr);

    const significantImpairment = stage >= 3 || (p.attributes.URINE_ALBUMIN as number) > 280;
    const severityFactor = stage >= 5 ? 1.2 : stage >= 4 ? 1 : stage >= 3 ? 1 : 0;

    if (!diagnosed && significantImpairment && ctx.rngUniform() < Math.min(1, monthlyRisk * Math.max(0.35, severityFactor))) {
      const code = stage >= 5 ? "N18.5" : stage >= 4 ? "N18.4" : "N18.3";
      const name =
        stage >= 5
          ? "Chronic kidney disease stage 5"
          : stage >= 4
          ? "Chronic kidney disease stage 4"
          : "Chronic kidney disease stage 3";
      ctx.emit({ type: "diagnosis", payload: { code, name } });
      p.diagnoses[code] = 1;
      const egfrLab = Number(((p.attributes.EGFR as number) ?? egfr).toFixed(1));
      const creat = Number(((p.attributes.SERUM_CREATININE as number) ?? 1.1).toFixed(2));
      const albuminBaseline = Number(((p.attributes.URINE_ALBUMIN as number) ?? 35).toFixed(1));
      ctx.emit({ type: "lab", payload: { id: "LAB_EGFR", name: "Estimated GFR", value: egfrLab } });
      ctx.emit({ type: "lab", payload: { id: "LAB_CREAT", name: "Serum creatinine", value: creat } });
      ctx.emit({ type: "lab", payload: { id: "LAB_UACR", name: "Urine albumin/creatinine", value: albuminBaseline } });
      if (!p.medsOn["ACE Inhibitor"]) {
        ctx.emit({ type: "medication", payload: { drug: "Lisinopril", dose: "10 mg daily" } });
        p.medsOn["ACE Inhibitor"] = 1;
        ctx.set("ckd_bp_control", (ctx.get("ckd_bp_control") ?? 0) + 0.5);
      }
      ctx.set("ckd_stage", stage);
      ctx.set("ckd_next_lab", ctx.now + 0.33);
    }

    if (diagnosed && stage >= 4 && !p.medsOn["SGLT2 inhibitor"] && (p.diagnoses["E11.9"] || ctx.rngUniform() < 0.35)) {
      ctx.emit({ type: "medication", payload: { drug: "Empagliflozin", dose: "10 mg daily" } });
      p.medsOn["SGLT2 inhibitor"] = 1;
      ctx.set("t2dm_med_adherence", Math.min(0.95, (ctx.get("t2dm_med_adherence") ?? 0.6) + 0.05));
    }

    const nextLab = ctx.get("ckd_next_lab") ?? (ctx.now + 0.6);
    if (ctx.now >= nextLab - 1e-6 && (diagnosed || egfr < 75)) {
      const egfrLab = clamp(egfr + ctx.rngNormal(0, 3), 8, 120);
      const creat = clamp((p.attributes.SERUM_CREATININE as number) + ctx.rngNormal(0, 0.2), 0.5, 7);
      const albumin = clamp((p.attributes.URINE_ALBUMIN as number) + ctx.rngNormal(0, 8), 5, 800);
      ctx.emit({ type: "lab", payload: { id: "LAB_EGFR", name: "Estimated GFR", value: Number(egfrLab.toFixed(1)) } });
      ctx.emit({ type: "lab", payload: { id: "LAB_CREAT", name: "Serum creatinine", value: Number(creat.toFixed(2)) } });
      ctx.emit({ type: "lab", payload: { id: "LAB_UACR", name: "Urine albumin/creatinine", value: Number(albumin.toFixed(1)) } });
      ctx.set("ckd_next_lab", ctx.now + (egfr < 45 ? 0.33 : 0.5));
    }

    if (diagnosed && !ctx.get("ckd_ultrasound_done") && ctx.rngUniform() < 0.1) {
      ctx.emit({ type: "procedure", payload: { code: "76770", name: "Renal ultrasound" } });
      ctx.set("ckd_ultrasound_done", 1);
    }

    if (stage >= 4 && ctx.rngUniform() < 0.02) {
      ctx.emit({ type: "encounter", payload: { kind: "Specialty" } });
    }

    if (stage >= 5 && ctx.rngUniform() < 0.05) {
      ctx.emit({ type: "procedure", payload: { code: "90935", name: "Hemodialysis session" } });
      if (!p.medsOn["Erythropoietin"]) {
        ctx.emit({ type: "medication", payload: { drug: "Erythropoietin", dose: "Weekly" } });
        p.medsOn["Erythropoietin"] = 1;
      }
    }
  },
  test() {
    const patient: any = {
      attributes: {
        AGE_YEARS: 72,
        EGFR: 42,
        URINE_ALBUMIN: 180,
        SYSTOLIC_BP: 150,
        SERUM_CREATININE: 1.9
      },
      diagnoses: { "E11.9": 1 },
      medsOn: {},
      signals: { ckd_next_lab: 0.1 }
    };
    const events: any[] = [];
    const ctx: any = {
      now: 60,
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
    return { passed: events.some((e) => e.type === "diagnosis" || e.type === "lab") };
  }
};

export default module;
