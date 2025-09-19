import type { DiseaseModule } from "../../src/contracts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const module: DiseaseModule = {
  id: "CoronaryArteryDisease",
  version: "1.0.0",
  summary: "Stable coronary artery disease with lipid management, angina episodes, and cardiac testing.",
  init(p, ctx) {
    ctx.set("cad_angina_burden", 0);
    ctx.set("cad_next_lipid", ctx.now + 1);
    ctx.set("cad_next_stress", ctx.now + (0.8 + ctx.rngUniform() * 0.6));
    ctx.set("cad_statin_effect", 0);
    ctx.set("cad_addon_lipid", 0);
    ctx.set("cad_next_statin_review", ctx.now + 1);
  },
  eligible(p) {
    return ((p.attributes.AGE_YEARS as number) ?? 0) >= 40;
  },
  risk(p, ctx) {
    const age = (p.attributes.AGE_YEARS as number) ?? 50;
    const sex = p.sexAtBirth ?? "U";
    const ldl = (p.attributes.LDL_CHOLESTEROL as number) ?? 120;
    const sbp = (p.attributes.SYSTOLIC_BP as number) ?? 120;
    const smoking = ctx.get("smokingPackYears") ?? 0;
    const diabetes = p.diagnoses["E11.9"] ? 1 : 0;
    const fhx = ctx.get("fhxCad") ?? 0;
    const stress = ctx.get("stressIndex") ?? 0.3;
    const ageLoad = Math.max(0, age - 50) * 0.0009;
    const lipidLoad = Math.max(0, ldl - 120) * 0.00035;
    const pressureLoad = Math.max(0, sbp - 135) * 0.0004;
    const smokingLoad = Math.min(60, smoking) * 0.00035;
    const base =
      0.004 +
      ageLoad +
      (sex === "M" ? 0.004 : 0) +
      lipidLoad +
      pressureLoad +
      smokingLoad +
      diabetes * 0.012 +
      fhx * 0.014 +
      stress * 0.006;
    const protective = Math.max(0, (ctx.get("activityScore") ?? 5) - 6) * 0.0008;
    return clamp(base - protective, 0.001, 0.25);
  },
  step(p, ctx) {
    const diagnosed = !!p.diagnoses["I25.10"];
    const monthlyRisk = this.risk(p, ctx) / 12;
    const anginaBurden = ctx.get("cad_angina_burden") ?? 0;

    if (!diagnosed && ctx.rngUniform() < monthlyRisk) {
      ctx.emit({ type: "diagnosis", payload: { code: "I25.10", name: "Coronary artery disease without angina" } });
      p.diagnoses["I25.10"] = 1;
      ctx.emit({ type: "procedure", payload: { code: "93454", name: "Coronary angiography" } });
      ctx.set("cad_angina_burden", 0.35);
      if (!p.medsOn["High-intensity statin"]) {
        const startHighIntensity = ctx.rngUniform() < 0.86;
        ctx.emit({
          type: "medication",
          payload: { drug: startHighIntensity ? "Atorvastatin" : "Simvastatin", dose: startHighIntensity ? "40 mg nightly" : "20 mg nightly" }
        });
        p.medsOn["High-intensity statin"] = startHighIntensity ? 1 : 0;
        ctx.set("cad_statin_effect", startHighIntensity ? 0.68 : 0.38);
      }
      if (!p.medsOn["Aspirin"] && ctx.rngUniform() < 0.9) {
        ctx.emit({ type: "medication", payload: { drug: "Aspirin", dose: "81 mg daily" } });
        p.medsOn["Aspirin"] = 1;
      }
      ctx.set("cad_next_lipid", ctx.now + 0.5);
      ctx.set("cad_next_statin_review", ctx.now + 0.75);
    }

    const anginaProb = clamp(anginaBurden * 0.02 + (diagnosed ? 0.006 : 0), 0, 0.08);
    if (ctx.rngUniform() < anginaProb) {
      const acute = ctx.rngUniform() < 0.25;
      ctx.emit({ type: "encounter", payload: { kind: acute ? "ED" : "Specialty" } });
      ctx.emit({ type: "procedure", payload: { code: acute ? "92950" : "93000", name: acute ? "Acute coronary care" : "Resting ECG" } });
      ctx.set("cad_angina_burden", clamp(anginaBurden + (acute ? 0.12 : 0.035), 0, 1.2));
    } else {
      ctx.set("cad_angina_burden", Math.max(0.04, anginaBurden * 0.94));
    }

    const nextLipid = ctx.get("cad_next_lipid") ?? (ctx.now + 1);
    if (ctx.now >= nextLipid - 1e-6 && (diagnosed || ctx.rngUniform() < 0.3)) {
      const ldl = clamp(((p.attributes.LDL_CHOLESTEROL as number) ?? 120) - (ctx.get("cad_statin_effect") ?? 0) * 35 - (ctx.get("cad_addon_lipid") ?? 0) * 18 + ctx.rngNormal(0, 8), 40, 220);
      const hdl = clamp(((p.attributes.HDL_CHOLESTEROL as number) ?? 45) + ctx.rngNormal(0, 4), 20, 120);
      const trig = clamp(((p.attributes.TRIGLYCERIDES as number) ?? 150) + ctx.rngNormal(0, 18), 40, 600);
      ctx.emit({ type: "lab", payload: { id: "LIPID_LDL", name: "LDL cholesterol", value: Math.round(ldl) } });
      ctx.emit({ type: "lab", payload: { id: "LIPID_HDL", name: "HDL cholesterol", value: Math.round(hdl) } });
      ctx.emit({ type: "lab", payload: { id: "LIPID_TG", name: "Triglycerides", value: Math.round(trig) } });
      ctx.set("cad_next_lipid", ctx.now + (ldl > 100 ? 0.5 : 1));
    }

    let statinEffect = ctx.get("cad_statin_effect") ?? 0;
    const ldlCurrent = (p.attributes.LDL_CHOLESTEROL as number) ?? 120;
    const nextStatinReview = ctx.get("cad_next_statin_review") ?? (ctx.now + 1);
    if (diagnosed && ctx.now >= nextStatinReview - 1e-6) {
      if (statinEffect < 0.8 && ldlCurrent > 95 && ctx.rngUniform() < 0.12) {
        ctx.emit({ type: "medication", payload: { drug: "Rosuvastatin", dose: "20 mg nightly" } });
        p.medsOn["High-intensity statin"] = 1;
        statinEffect = 0.9;
        ctx.set("cad_statin_effect", statinEffect);
      }
      ctx.set("cad_next_statin_review", ctx.now + 1.2);
    }

    const currentLdl = ldlCurrent;
    if (diagnosed && statinEffect >= 0.8 && (ctx.get("cad_addon_lipid") ?? 0) < 0.5 && currentLdl > 90 && ctx.now >= nextStatinReview - 1e-6 && ctx.rngUniform() < 0.08) {
      ctx.emit({ type: "medication", payload: { drug: "Ezetimibe", dose: "10 mg daily" } });
      ctx.set("cad_addon_lipid", 0.5);
    }

    const nextStress = ctx.get("cad_next_stress") ?? (ctx.now + 1.4);
    if (ctx.now >= nextStress - 1e-6 && (diagnosed || anginaBurden > 0.45)) {
      ctx.emit({ type: "procedure", payload: { code: "93015", name: "Cardiac stress test" } });
      ctx.set("cad_next_stress", ctx.now + 1.7 + ctx.rngUniform() * 0.3);
    }

    if (diagnosed && ctx.rngUniform() < 0.006 && (ctx.get("cad_angina_burden") ?? 0) > 1.1) {
      ctx.emit({ type: "encounter", payload: { kind: "Inpatient" } });
      ctx.emit({ type: "procedure", payload: { code: "92928", name: "Percutaneous coronary intervention" } });
      ctx.set("cad_angina_burden", 0.4);
    }
  },
  test() {
    const patient: any = {
      attributes: {
        AGE_YEARS: 67,
        LDL_CHOLESTEROL: 160,
        SYSTOLIC_BP: 150
      },
      diagnoses: { "E11.9": 1 },
      medsOn: {},
      sexAtBirth: "M",
      signals: { stressIndex: 0.5, smokingPackYears: 25, fhxCad: 1 }
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
    return { passed: events.some((e) => e.type === "diagnosis" || e.type === "medication") };
  }
};

export default module;
