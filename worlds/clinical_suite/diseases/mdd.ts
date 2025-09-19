import type { DiseaseModule } from "../../src/contracts";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const module: DiseaseModule = {
  id: "MajorDepressiveDisorder",
  version: "1.0.0",
  summary: "Recurrent major depressive disorder with symptom monitoring, therapy encounters, and pharmacotherapy escalation.",
  init(p, ctx) {
    const baseline = (p.attributes.PHQ9_SCORE as number) ?? 5;
    ctx.set("mdd_phq9", baseline);
    ctx.set("mdd_next_screen", ctx.now + 1);
    ctx.set("mdd_next_therapy", ctx.now + 0.5);
  },
  eligible(p) {
    return ((p.attributes.AGE_YEARS as number) ?? 0) >= 18;
  },
  risk(p, ctx) {
    const stress = ctx.get("stressIndex") ?? 0.3;
    const socioeconomic = ctx.get("socioeconomicIndex") ?? 55;
    const support = p.attributes.MENTAL_HEALTH_SUPPORT === "Regular" ? -0.015 : p.attributes.MENTAL_HEALTH_SUPPORT === "Occasional" ? -0.008 : 0;
    const chronicBurden =
      (p.diagnoses["E11.9"] ? 0.01 : 0) +
      (p.diagnoses["I25.10"] ? 0.012 : 0) +
      (p.diagnoses["N18.3"] || p.diagnoses["N18.4"] || p.diagnoses["N18.5"] ? 0.015 : 0);
    const sleep = (p.attributes.SLEEP_HOURS as number) ?? 7;
    const base =
      0.0035 +
      stress * 0.03 +
      chronicBurden +
      (sleep < 6.5 ? 0.006 : 0) +
      (socioeconomic < 40 ? 0.01 : 0) +
      support;
    const resilience = Math.max(0, (ctx.get("activityScore") ?? 5) - 6) * 0.0015;
    return clamp(base - resilience, 0.0008, 0.22);
  },
  step(p, ctx) {
    const diagnosed = !!p.diagnoses["F33.1"];
    const monthlyRisk = this.risk(p, ctx) / 12;
    const stress = ctx.get("stressIndex") ?? 0.3;
    const sleepQuality = ctx.get("sleepQuality") ?? ((p.attributes.SLEEP_HOURS as number) ?? 7) / 8;
    const activity = ctx.get("activityScore") ?? 5;
    const supportSignal = p.attributes.MENTAL_HEALTH_SUPPORT === "Regular" ? 0.2 : p.attributes.MENTAL_HEALTH_SUPPORT === "Occasional" ? 0.1 : 0;

    if (!diagnosed && ctx.rngUniform() < monthlyRisk) {
      ctx.emit({ type: "diagnosis", payload: { code: "F33.1", name: "Recurrent major depressive disorder, moderate" } });
      p.diagnoses["F33.1"] = 1;
      const baseline = (p.attributes.PHQ9_SCORE as number) ?? 8;
      ctx.set("mdd_phq9", clamp(baseline + 3, 8, 24));
      if (!p.medsOn["SSRI"]) {
        ctx.emit({ type: "medication", payload: { drug: "Sertraline", dose: "50 mg daily" } });
        p.medsOn["SSRI"] = 1;
      }
      ctx.set("mdd_next_screen", ctx.now + 0.25);
      ctx.set("mdd_next_therapy", ctx.now + 0.7 + (supportSignal > 0 ? 0.3 : 0));
      ctx.schedule(0.08, { type: "encounter", payload: { kind: "Specialty" } });
      ctx.schedule(0.08, { type: "procedure", payload: { code: "90837", name: "Psychotherapy 60 minutes" } });
    }

    let phq9 = ctx.get("mdd_phq9") ?? ((p.attributes.PHQ9_SCORE as number) ?? 5);
    const medAdherence = p.medsOn["SSRI"] ? 0.65 + ctx.rngUniform() * 0.2 : 0;
    const therapyEffect = supportSignal + (diagnosed ? 0.05 : 0);
    const upward = stress * 8 + (1 - sleepQuality) * 4 + Math.max(0, 6 - activity) * 0.8;
    const downward = medAdherence * 3 + therapyEffect * 2;
    phq9 = clamp(phq9 + (upward - downward) * 0.05, 0, 27);
    ctx.set("mdd_phq9", phq9);

    if (diagnosed && phq9 > 14 && !p.medsOn["Augmentation"] && ctx.rngUniform() < 0.25) {
      ctx.emit({ type: "medication", payload: { drug: "Bupropion", dose: "150 mg daily" } });
      p.medsOn["Augmentation"] = 1;
    }

    const nextScreen = ctx.get("mdd_next_screen") ?? (ctx.now + 0.75);
    if (ctx.now >= nextScreen - 1e-6) {
      const score = clamp(phq9 + ctx.rngNormal(0, 1.5), 0, 27);
      ctx.emit({ type: "lab", payload: { id: "PHQ9", name: "PHQ-9 depression score", value: Number(score.toFixed(0)) } });
      ctx.set("mdd_next_screen", ctx.now + (diagnosed ? 0.33 : 0.75));
    }

    const nextTherapy = ctx.get("mdd_next_therapy") ?? (ctx.now + 0.7);
    if (diagnosed && ctx.now >= nextTherapy - 1e-6) {
      ctx.emit({ type: "encounter", payload: { kind: "Specialty" } });
      ctx.emit({ type: "procedure", payload: { code: "90837", name: "Psychotherapy 60 minutes" } });
      ctx.set("mdd_next_therapy", ctx.now + 0.7 + (supportSignal > 0 ? 0.3 : 0));
    }
  },
  test() {
    const patient: any = {
      attributes: {
        AGE_YEARS: 40,
        PHQ9_SCORE: 9,
        SLEEP_HOURS: 6,
        MENTAL_HEALTH_SUPPORT: "None"
      },
      diagnoses: {},
      medsOn: {},
      signals: { stressIndex: 0.8, sleepQuality: 0.7, activityScore: 3, socioeconomicIndex: 32 }
    };
    const events: any[] = [];
    const ctx: any = {
      now: 30,
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
