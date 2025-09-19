import type { AttributeGroupModule } from "../../src/contracts";

type RNG = () => number;

function createRng(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const module: AttributeGroupModule = {
  id: "DemographicsCore",
  category: "Demographics",
  summary: "Basic demographic traits including age, sex, and socioeconomic signals.",
  generate(seed: number, birthYear: number) {
    const rand = createRng(seed ^ birthYear);
    const age = 18 + Math.floor(rand() * 70);
    const sex = rand() > 0.5 ? "F" : "M";
    const income = 35000 + Math.floor(rand() * 70000);
    return {
      attributes: {
        AGE_YEARS: {
          value: age,
          durability: "intrinsic",
          type: "number",
          limits: { min: 0, max: 120 },
          description: "Age in years"
        },
        SEX_AT_BIRTH: {
          value: sex,
          durability: "intrinsic",
          type: "string",
          description: "Sex assigned at birth"
        },
        HOUSEHOLD_INCOME: {
          value: income,
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 250000 },
          description: "Estimated household income in USD"
        }
      },
      signals: {
        socioeconomicIndex: Math.round(income / 10000)
      },
      sexAtBirth: sex as "M" | "F"
    };
  },
  test() {
    const sample = this.generate(123, 1980);
    const hasAge = typeof sample.attributes.AGE_YEARS?.value === "number";
    const hasSex = typeof sample.attributes.SEX_AT_BIRTH?.value === "string";
    return { passed: hasAge && hasSex };
  }
};

export default module;
