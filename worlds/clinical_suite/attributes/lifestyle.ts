import type { AttributeGroupModule } from "../../src/contracts";

type RNG = () => number;

function createRng(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 0xffffffff;
  };
}

const alcoholLevels = ["None", "Low", "Moderate", "High"] as const;
const mentalHealthSupport = ["None", "Occasional", "Regular"] as const;

const module: AttributeGroupModule = {
  id: "LifestyleProfile",
  category: "Lifestyle",
  summary: "Lifestyle behaviors, substance exposure, and protective factors impacting chronic disease risk.",
  generate(seed: number, birthYear: number) {
    const rng = createRng(seed + birthYear * 17);

    const smokingRoll = rng();
    let smokingStatus: "Never" | "Former" | "Current";
    if (smokingRoll < 0.58) smokingStatus = "Never";
    else if (smokingRoll < 0.82) smokingStatus = "Former";
    else smokingStatus = "Current";

    let packYears = 0;
    if (smokingStatus === "Former") packYears = Number((rng() * 20 + 5).toFixed(1));
    if (smokingStatus === "Current") packYears = Number((rng() * 30 + 10).toFixed(1));

    const alcoholIdx = Math.min(alcoholLevels.length - 1, Math.floor(rng() * 4));
    const activityScore = Math.round(2 + rng() * 8); // 0-10 scale
    const dietScore = Math.round(35 + rng() * 50 - (smokingStatus === "Current" ? 8 : 0));
    const sleepHours = Number((6 + rng() * 2.5).toFixed(1));
    const exposureDust = rng() < 0.12 && smokingStatus !== "Never";
    const mentalHealthIdx = Math.min(mentalHealthSupport.length - 1, Math.floor(rng() * 3));

    const stressBase = 0.35 + (packYears / 80) + (alcoholIdx * 0.1) - activityScore / 18 - dietScore / 250 + (sleepHours < 6.5 ? 0.12 : -0.05);
    const stressIndex = Math.min(1, Math.max(0.05, Number(stressBase.toFixed(2))));

    return {
      attributes: {
        SMOKING_STATUS: {
          value: smokingStatus,
          durability: "semi_durable",
          type: "string",
          description: "Smoking status using standard categories"
        },
        SMOKING_PACK_YEARS: {
          value: Number(packYears.toFixed(1)),
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 120 },
          description: "Cumulative pack-year exposure"
        },
        ALCOHOL_USE_LEVEL: {
          value: alcoholLevels[alcoholIdx],
          durability: "semi_durable",
          type: "string",
          description: "Average alcohol consumption level"
        },
        PHYSICAL_ACTIVITY_LEVEL: {
          value: activityScore,
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 10 },
          description: "Weekly physical activity score on a 0-10 scale"
        },
        DIET_QUALITY_SCORE: {
          value: Math.max(10, Math.min(100, dietScore)),
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 100 },
          description: "Composite diet quality score (Healthy Eating Index style)"
        },
        SLEEP_HOURS: {
          value: sleepHours,
          durability: "semi_durable",
          type: "number",
          limits: { min: 3, max: 12 },
          description: "Average nightly sleep duration"
        },
        OCCUPATIONAL_EXPOSURE_DUST: {
          value: exposureDust,
          durability: "semi_durable",
          type: "boolean",
          description: "Regular occupational exposure to dust or fumes"
        },
        MENTAL_HEALTH_SUPPORT: {
          value: mentalHealthSupport[mentalHealthIdx],
          durability: "semi_durable",
          type: "string",
          description: "Baseline access to supportive counseling or therapy"
        }
      },
      signals: {
        smokingPackYears: packYears,
        smokingIntensity: smokingStatus === "Current" ? 1 : smokingStatus === "Former" ? 0.4 : 0,
        activityScore,
        dietScore: Math.max(10, Math.min(100, dietScore)),
        sleepQuality: sleepHours / 8,
        stressIndex
      }
    };
  },
  test() {
    const sample = this.generate(9876, 1965);
    const attrs = sample.attributes;
    const hasSmoking = typeof attrs.SMOKING_STATUS?.value === "string";
    const hasPackYears = typeof attrs.SMOKING_PACK_YEARS?.value === "number";
    return { passed: hasSmoking && hasPackYears };
  }
};

export default module;
