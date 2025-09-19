import type { AttributeGroupModule } from "../../src/contracts";

type RNG = () => number;

function createRng(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state * 22695477 + 1) >>> 0;
    return state / 0xffffffff;
  };
}

const module: AttributeGroupModule = {
  id: "ClinicalBaseline",
  category: "Clinical Baseline",
  summary: "Baseline vitals and laboratory markers with gentle longitudinal drift in response to lifestyle and disease signals.",
  generate(seed: number, birthYear: number) {
    const rng = createRng(seed ^ (birthYear * 97));

    const metabolicFactor = rng();
    const cardioFactor = rng();
    const renalFactor = rng();
    const respiratoryFactor = rng();
    const moodFactor = rng();

    const bmi = Number((22.5 + metabolicFactor * 12 + rng() * 1.5).toFixed(1));
    const systolic = Math.round(108 + cardioFactor * 35 + metabolicFactor * 4);
    const diastolic = Math.round(68 + cardioFactor * 18);
    const ldl = Math.round(95 + cardioFactor * 55 - rng() * 10);
    const hdl = Math.round(38 + (1 - metabolicFactor) * 18 + rng() * 5);
    const triglycerides = Math.round(110 + metabolicFactor * 120 + rng() * 20);
    const fastingGlucose = Math.round(88 + metabolicFactor * 45 + rng() * 8);
    const hba1c = Number((5.1 + metabolicFactor * 1.9 + rng() * 0.2).toFixed(1));
    const egfr = Number((70 + (1 - renalFactor) * 45).toFixed(1));
    const creatinine = Number((0.7 + renalFactor * 1.2).toFixed(2));
    const urineAlbumin = Number((12 + renalFactor * 40 + metabolicFactor * 10).toFixed(1));
    const respiratoryCapacity = Math.round(78 + (1 - respiratoryFactor) * 18);
    const baselinePhq9 = Math.round(2 + moodFactor * 10 + rng() * 3);

    return {
      attributes: {
        BMI: {
          value: bmi,
          durability: "semi_durable",
          type: "number",
          limits: { min: 15, max: 60 },
          description: "Body mass index at baseline"
        },
        SYSTOLIC_BP: {
          value: systolic,
          durability: "semi_durable",
          type: "number",
          limits: { min: 90, max: 220 },
          description: "Systolic blood pressure (mmHg)"
        },
        DIASTOLIC_BP: {
          value: diastolic,
          durability: "semi_durable",
          type: "number",
          limits: { min: 50, max: 140 },
          description: "Diastolic blood pressure (mmHg)"
        },
        LDL_CHOLESTEROL: {
          value: ldl,
          durability: "semi_durable",
          type: "number",
          limits: { min: 40, max: 260 },
          description: "Low-density lipoprotein cholesterol"
        },
        HDL_CHOLESTEROL: {
          value: hdl,
          durability: "semi_durable",
          type: "number",
          limits: { min: 20, max: 120 },
          description: "High-density lipoprotein cholesterol"
        },
        TRIGLYCERIDES: {
          value: triglycerides,
          durability: "semi_durable",
          type: "number",
          limits: { min: 40, max: 600 },
          description: "Triglycerides (mg/dL)"
        },
        FASTING_GLUCOSE: {
          value: fastingGlucose,
          durability: "semi_durable",
          type: "number",
          limits: { min: 60, max: 350 },
          description: "Fasting plasma glucose"
        },
        HBA1C: {
          value: hba1c,
          durability: "semi_durable",
          type: "number",
          limits: { min: 4.5, max: 14 },
          description: "Hemoglobin A1c percentage"
        },
        EGFR: {
          value: egfr,
          durability: "stateful",
          type: "number",
          limits: { min: 5, max: 140 },
          description: "Estimated glomerular filtration rate (mL/min/1.73m^2)"
        },
        SERUM_CREATININE: {
          value: creatinine,
          durability: "semi_durable",
          type: "number",
          limits: { min: 0.4, max: 8 },
          description: "Serum creatinine (mg/dL)"
        },
        URINE_ALBUMIN: {
          value: urineAlbumin,
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 800 },
          description: "Spot urine albumin-to-creatinine ratio (mg/g)"
        },
        RESPIRATORY_CAPACITY: {
          value: respiratoryCapacity,
          durability: "stateful",
          type: "number",
          limits: { min: 30, max: 120 },
          description: "Estimated FEV1 percent predicted"
        },
        PHQ9_SCORE: {
          value: Math.min(24, baselinePhq9),
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 27 },
          description: "Baseline Patient Health Questionnaire-9 score"
        }
      },
      signals: {
        metabolicSetpoint: bmi,
        bpSetpoint: systolic,
        lipidSetpoint: ldl,
        renalBaseline: egfr,
        renalDeclineRate: 0.8 + renalFactor * 1.2,
        pulmonaryBaseline: respiratoryCapacity,
        pulmonaryDeclineRate: 0.4 + respiratoryFactor * 1.1,
        phq9Baseline: baselinePhq9,
        metabolicFactor,
        cardioFactor
      }
    };
  },
  update(p, ctx, deltaYears: number) {
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    const activity = ctx.get("activityScore") ?? 5;
    const dietScore = ctx.get("dietScore") ?? 55;
    const stress = ctx.get("stressIndex") ?? 0.3;
    const smokingIntensity = ctx.get("smokingIntensity") ?? 0;
    const packYears = ctx.get("smokingPackYears") ?? 0;
    const metabolicFactor = ctx.get("metabolicFactor") ?? 0.5;
    const cardioFactor = ctx.get("cardioFactor") ?? 0.5;
    const adherence = ctx.get("t2dm_med_adherence") ?? 0;

    const bmi = (p.attributes.BMI as number) ?? 26;
    const bmiSetpoint = ctx.get("metabolicSetpoint") ?? bmi;
    const bmiTarget = bmiSetpoint + (6 - activity) * 0.4 + (65 - dietScore) * 0.1 + stress * 0.6 - adherence * 1.2;
    const bmiUpdated = clamp(bmi + (bmiTarget - bmi) * 0.15 * deltaYears, 16, 50);
    ctx.setAttr("BMI", Number(bmiUpdated.toFixed(1)));

    const systolic = (p.attributes.SYSTOLIC_BP as number) ?? 120;
    const baselineSbp = ctx.get("bpSetpoint") ?? systolic;
    const statinEffect = ctx.get("cad_statin_effect") ?? 0;
    const antihypertensive = ctx.get("ckd_bp_control") ?? 0;
    const sbpTarget = baselineSbp + stress * 6 + (bmiUpdated - bmiSetpoint) * 1.5 + smokingIntensity * 4 - antihypertensive * 8 - statinEffect * 2;
    const sbpUpdated = clamp(systolic + (sbpTarget - systolic) * 0.2 * deltaYears, 95, 190);
    ctx.setAttr("SYSTOLIC_BP", Math.round(sbpUpdated));
    const diastolic = (p.attributes.DIASTOLIC_BP as number) ?? 75;
    const dbpTarget = diastolic + (sbpTarget - systolic) * 0.5;
    const dbpUpdated = clamp(diastolic + (dbpTarget - diastolic) * 0.18 * deltaYears, 50, 120);
    ctx.setAttr("DIASTOLIC_BP", Math.round(dbpUpdated));

    const a1cSignal = ctx.get("t2dm_a1c") ?? ((p.attributes.HBA1C as number) ?? 5.6);
    const a1cNoise = ctx.rngNormal(0, 0.04);
    ctx.setAttr("HBA1C", Number(clamp(a1cSignal + a1cNoise, 4.9, 11).toFixed(1)));

    const fastingGlucose = (p.attributes.FASTING_GLUCOSE as number) ?? 95;
    const glucoseTarget = clamp(95 + metabolicFactor * 10 + (a1cSignal - 6.2) * 18 - adherence * 25 + stress * 8, 75, 240);
    const glucoseUpdated = clamp(fastingGlucose + (glucoseTarget - fastingGlucose) * 0.18 * deltaYears, 70, 260);
    ctx.setAttr("FASTING_GLUCOSE", Math.round(glucoseUpdated));

    const renalBaseline = ctx.get("renalBaseline") ?? ((p.attributes.EGFR as number) ?? 85);
    const renalDeclineBase = (ctx.get("renalDeclineRate") ?? 1) * 0.34;
    const age = ctx.now ?? 0;
    const diabetesBurden = Math.max(0, a1cSignal - 6.8);
    const bpBurden = Math.max(0, sbpUpdated - 132) / 35;
    const ageRelatedDecline = Math.max(0, age - 60) * 0.005;
    const renalDecline = (renalDeclineBase + diabetesBurden * 0.35 + bpBurden * 0.3 + ageRelatedDecline) * deltaYears;
    const egfrCurrent = (p.attributes.EGFR as number) ?? renalBaseline;
    const egfrUpdated = clamp(egfrCurrent - renalDecline, 15, 120);
    ctx.setAttr("EGFR", Number(egfrUpdated.toFixed(1)));
    const creatinine = clamp(0.6 + (110 - egfrUpdated) / 90, 0.5, 4.5);
    ctx.setAttr("SERUM_CREATININE", Number(creatinine.toFixed(2)));
    const albuminCurrent = (p.attributes.URINE_ALBUMIN as number) ?? 20;
    const albuminTarget = clamp(20 + diabetesBurden * 50 + bpBurden * 40, 5, 400);
    const albuminUpdated = clamp(albuminCurrent + (albuminTarget - albuminCurrent) * 0.18 * deltaYears, 5, 500);
    ctx.setAttr("URINE_ALBUMIN", Number(albuminUpdated.toFixed(1)));
    ctx.set("renal_function", egfrUpdated);

    const pulmonaryBaseline = ctx.get("pulmonaryBaseline") ?? ((p.attributes.RESPIRATORY_CAPACITY as number) ?? 90);
    const pulmonaryDecay = (ctx.get("pulmonaryDeclineRate") ?? 0.6) * 0.35 + smokingIntensity * 0.8 + (packYears > 30 ? 0.4 : 0) + (p.attributes.OCCUPATIONAL_EXPOSURE_DUST ? 0.25 : 0);
    const pulmonaryCurrent = (p.attributes.RESPIRATORY_CAPACITY as number) ?? pulmonaryBaseline;
    const pulmonaryTarget = pulmonaryBaseline - pulmonaryDecay * 5;
    const pulmonaryUpdated = clamp(pulmonaryCurrent + (pulmonaryTarget - pulmonaryCurrent) * 0.12 * deltaYears, 40, 110);
    ctx.setAttr("RESPIRATORY_CAPACITY", Math.round(pulmonaryUpdated));
    ctx.set("pulmonary_capacity", pulmonaryUpdated);

    const lipidSet = ctx.get("lipidSetpoint") ?? ((p.attributes.LDL_CHOLESTEROL as number) ?? 120);
    const addon = (ctx.get("cad_addon_lipid") ?? 0) * 20;
    const ldlCurrent = (p.attributes.LDL_CHOLESTEROL as number) ?? lipidSet;
    const ldlTarget = clamp(lipidSet - statinEffect * 40 - addon + Math.max(0, 65 - dietScore) * 0.5 - activity * 0.6, 55, 190);
    const ldlUpdated = clamp(ldlCurrent + (ldlTarget - ldlCurrent) * 0.2 * deltaYears, 55, 200);
    ctx.setAttr("LDL_CHOLESTEROL", Math.round(ldlUpdated));

    const hdlCurrent = (p.attributes.HDL_CHOLESTEROL as number) ?? 45;
    const hdlTarget = clamp(hdlCurrent + (activity - 5) * 1.2 - smokingIntensity * 2.5 + metabolicFactor * -1.5, 30, 90);
    const hdlUpdated = clamp(hdlCurrent + (hdlTarget - hdlCurrent) * 0.18 * deltaYears, 30, 95);
    ctx.setAttr("HDL_CHOLESTEROL", Math.round(hdlUpdated));

    const trigCurrent = (p.attributes.TRIGLYCERIDES as number) ?? 160;
    const trigTarget = clamp(160 + Math.max(0, 65 - dietScore) * 2 - activity * 5 - statinEffect * 15 + metabolicFactor * 30, 90, 350);
    const trigUpdated = clamp(trigCurrent + (trigTarget - trigCurrent) * 0.2 * deltaYears, 80, 380);
    ctx.setAttr("TRIGLYCERIDES", Math.round(trigUpdated));

    const moodSignal = ctx.get("mdd_phq9") ?? ((p.attributes.PHQ9_SCORE as number) ?? ctx.get("phq9Baseline") ?? 5);
    const supportEffect = p.attributes.MENTAL_HEALTH_SUPPORT === "Regular" ? -2 : p.attributes.MENTAL_HEALTH_SUPPORT === "Occasional" ? -1 : 0;
    const moodTarget = clamp(moodSignal + supportEffect - activity * 0.1 + stress * 1.5, 0, 24);
    const moodUpdated = clamp((p.attributes.PHQ9_SCORE as number) ?? moodSignal + (moodTarget - moodSignal) * 0.2, 0, 27);
    ctx.setAttr("PHQ9_SCORE", Math.round(moodUpdated));
  },
  test() {
    const sample = this.generate(13579, 1960);
    const attrs = sample.attributes;
    const hasBmi = typeof attrs.BMI?.value === "number";
    const hasEgfr = typeof attrs.EGFR?.value === "number";
    return { passed: hasBmi && hasEgfr };
  }
};

export default module;
