import type { AttributeGroupModule } from "../../src/contracts";

type RNG = () => number;

function createRng(seed: number): RNG {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 0xffffffff;
  };
}

const module: AttributeGroupModule = {
  id: "VitalsBaseline",
  category: "Vitals",
  summary: "Baseline vital signs and cardiometabolic risk markers.",
  generate(seed: number, birthYear: number) {
    const rand = createRng(seed + birthYear);
    const bmi = 18 + rand() * 12;
    const sbp = 105 + rand() * 30;
    const dbp = 65 + rand() * 15;
    const hdl = 35 + rand() * 20;
    return {
      attributes: {
        BMI: {
          value: Number(bmi.toFixed(1)),
          durability: "semi_durable",
          type: "number",
          limits: { min: 12, max: 60 },
          description: "Body mass index"
        },
        SYSTOLIC_BP: {
          value: Math.round(sbp),
          durability: "semi_durable",
          type: "number",
          limits: { min: 90, max: 200 },
          description: "Systolic blood pressure"
        },
        DIASTOLIC_BP: {
          value: Math.round(dbp),
          durability: "semi_durable",
          type: "number",
          limits: { min: 50, max: 130 },
          description: "Diastolic blood pressure"
        },
        HDL_CHOLESTEROL: {
          value: Math.round(hdl),
          durability: "semi_durable",
          type: "number",
          limits: { min: 20, max: 120 },
          description: "HDL cholesterol"
        }
      },
      signals: {
        cardioRisk: Math.max(0, Math.round((sbp - 120) / 5) + Math.round((bmi - 25)))
      }
    };
  },
  test() {
    const sample = this.generate(2024, 1980);
    return { passed: typeof sample.attributes.BMI?.value === "number" };
  }
};

export default module;
