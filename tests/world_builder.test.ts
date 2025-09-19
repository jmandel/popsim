import { join } from "node:path";
import { rm } from "node:fs/promises";
import { describe, expect, it, beforeAll, afterAll } from "bun:test";

import { buildWorld } from "../src/world_builder";
import type { LanguageModel } from "../src/llm";
import { runSimulation } from "../src/sim";

class StubLanguageModel implements LanguageModel {
  private structured: Array<() => unknown>;
  private snippets: string[];

  constructor(structured: Array<() => unknown>, snippets: string[]) {
    this.structured = structured;
    this.snippets = snippets;
  }

  async structuredJSON<T>(schema: any, _system: string, _user: string): Promise<T> {
    const next = this.structured.shift();
    if (!next) throw new Error("No structured outputs left");
    const payload = next();
    return schema.parse(payload);
  }

  async generateTS(_system: string, _user: string): Promise<string> {
    const next = this.snippets.shift();
    if (!next) throw new Error("No code snippets left");
    return next;
  }
}

describe("buildWorld with stub language model", () => {
  const outputDir = join("out", "test-world");

  beforeAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("generates a world and validates it", async () => {
    const attributeModuleSource = `export default {
      id: "LifestyleBasics",
      category: "Lifestyle",
      summary: "Test attribute group",
      generate(seed: number, birthYear: number) {
        return {
          attributes: {
            AGE_YEARS: { value: 30, durability: "intrinsic", type: "number", limits: { min: 0, max: 120 } },
            SEX_AT_BIRTH: { value: "F", durability: "intrinsic", type: "string" },
            BMI: { value: 24.5, durability: "semi_durable", type: "number", limits: { min: 10, max: 60 } }
          },
          signals: { BMI: 24.5 },
          sexAtBirth: "F"
        };
      },
      test() { return { passed: true }; }
    };`;

    const diseaseModuleSource = `export default {
      id: "MetabolicTest",
      version: "0.0.1",
      summary: "Metabolic condition for testing",
      eligible(p: any) {
        return typeof p.attributes.BMI === "number";
      },
      risk() { return 0.5; },
      step(p: any, ctx: any) {
        if (!p.diagnoses["E66"] && ctx.rngUniform() < 0.5) {
          ctx.emit({ type: "diagnosis", payload: { code: "E66", name: "Obesity" } });
        }
      },
      invariants() { return []; },
      test() { return { passed: true }; }
    };`;

    const stub = new StubLanguageModel(
      [
        () => ({
          categories: [
            {
              name: "Lifestyle",
              description: "Lifestyle metrics",
              targetCount: 3,
              durabilityMix: { intrinsic: 0.5, semi_durable: 0.3, stateful: 0.2 }
            }
          ]
        }),
        () => ({ diseases: [{ name: "Metabolic Syndrome" }] })
      ],
      [attributeModuleSource, diseaseModuleSource]
    );

    const world = await buildWorld({
      seed: 123,
      attributeGroups: 1,
      diseaseCount: 1,
      outputDir,
      llm: stub
    });

    expect(world.attributeModules).toHaveLength(1);
    expect(world.diseaseModules).toHaveLength(1);
    expect(world.attributeCatalogPath).toBe(join(outputDir, "attribute_catalog.json"));

    const validation = await Bun.file(join(outputDir, "validation.json")).json();
    expect(validation.ok).toBe(true);

    const patients = await runSimulation({ n: 5, world });
    expect(patients.length).toBe(5);
    expect(patients[0].events.length).toBeGreaterThan(0);
  });
});
