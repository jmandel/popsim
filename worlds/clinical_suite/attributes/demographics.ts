import type { AttributeGroupModule } from "../../src/contracts";

type RNG = () => number;

function createRng(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const races = [
  "White",
  "Black or African American",
  "Asian",
  "American Indian or Alaska Native",
  "Native Hawaiian or Other Pacific Islander",
  "Other"
];

const educationLevels = [
  "Less than high school",
  "High school diploma",
  "Some college",
  "Bachelor's degree",
  "Graduate degree"
];

const module: AttributeGroupModule = {
  id: "DemographicsExtended",
  category: "Demographics",
  summary: "Expanded demographic context with socioeconomic and family history indicators.",
  generate(seed: number, birthYear: number) {
    const rng = createRng(seed ^ (birthYear * 131));
    const age = 30 + Math.floor(rng() * 55);
    const sex = rng() < 0.52 ? "F" : "M";
    const race = races[Math.floor(rng() * races.length)];
    const ethnicity = rng() < 0.18 ? "Hispanic or Latino" : "Not Hispanic or Latino";
    const income = Math.round(28000 + rng() * 90000);
    const educationIdx = Math.min(educationLevels.length - 1, Math.floor(rng() * educationLevels.length + (income > 80000 ? 1 : 0)));
    const education = educationLevels[Math.max(0, educationIdx)];

    const householdSize = 1 + Math.floor(rng() * 4);
    const socioeconomicIndex = Math.min(100, Math.max(5, Math.round(income / 1500 + (educationIdx + 1) * 4 - householdSize * 2)));

    const fhxDiabetes = rng() < 0.32;
    const fhxCad = rng() < 0.28;

    let insurance: string;
    if (age >= 65) {
      insurance = rng() < 0.7 ? "Medicare" : "Medicare Advantage";
    } else if (income < 25000) {
      insurance = rng() < 0.6 ? "Medicaid" : "Uninsured";
    } else {
      insurance = rng() < 0.2 ? "Exchange plan" : "Commercial";
    }

    const preventiveAdherence = Math.min(1, Math.max(0.1, socioeconomicIndex / 120 + (fhxCad ? 0.1 : 0) + (educationIdx >= 3 ? 0.1 : 0)));

    return {
      attributes: {
        AGE_YEARS: {
          value: age,
          durability: "intrinsic",
          type: "number",
          limits: { min: 0, max: 120 },
          description: "Age in years at simulation start"
        },
        SEX_AT_BIRTH: {
          value: sex,
          durability: "intrinsic",
          type: "string",
          description: "Sex assigned at birth"
        },
        RACE: {
          value: race,
          durability: "intrinsic",
          type: "string",
          description: "Self-identified race"
        },
        ETHNICITY: {
          value: ethnicity,
          durability: "intrinsic",
          type: "string",
          description: "Ethnicity per OMB standards"
        },
        HOUSEHOLD_INCOME: {
          value: income,
          durability: "semi_durable",
          type: "number",
          limits: { min: 0, max: 250000 },
          description: "Estimated annual household income (USD)"
        },
        HOUSEHOLD_SIZE: {
          value: householdSize,
          durability: "semi_durable",
          type: "number",
          limits: { min: 1, max: 10 },
          description: "Number of people living in the home"
        },
        EDUCATION_LEVEL: {
          value: education,
          durability: "semi_durable",
          type: "string",
          description: "Highest completed education level"
        },
        INSURANCE_TYPE: {
          value: insurance,
          durability: "semi_durable",
          type: "string",
          description: "Primary insurance coverage"
        },
        FAMILY_HISTORY_DIABETES: {
          value: fhxDiabetes,
          durability: "intrinsic",
          type: "boolean",
          description: "Family history of type 2 diabetes"
        },
        FAMILY_HISTORY_CAD: {
          value: fhxCad,
          durability: "intrinsic",
          type: "boolean",
          description: "Family history of coronary artery disease"
        }
      },
      signals: {
        socioeconomicIndex,
        preventiveAdherence,
        fhxDiabetes: fhxDiabetes ? 1 : 0,
        fhxCad: fhxCad ? 1 : 0
      },
      sexAtBirth: sex as "M" | "F"
    };
  },
  test() {
    const sample = this.generate(12345, 1975);
    const attrs = sample.attributes;
    const hasCore = typeof attrs.AGE_YEARS?.value === "number" && typeof attrs.SEX_AT_BIRTH?.value === "string";
    const hasSignals = typeof sample.signals?.socioeconomicIndex === "number";
    return { passed: hasCore && hasSignals };
  }
};

export default module;
