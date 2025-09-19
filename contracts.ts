import { z } from "zod";

/** ===== World registry ===== */
export const AttributeCategoryPlan = z.object({
  name: z.string(),
  description: z.string(),
  targetCount: z.number().int().min(3).max(300),
  durabilityMix: z.object({
    intrinsic: z.number().min(0).max(1),
    semi_durable: z.number().min(0).max(1),
    stateful: z.number().min(0).max(1)
  })
});
export type AttributeCategoryPlan = z.infer<typeof AttributeCategoryPlan>;

export const WorldRegistry = z.object({
  version: z.string().default("0.4"),
  seed: z.number().int().nonnegative().default(42),
  model: z.string().default("gpt-4o-2024-08-06"),
  categories: z.array(AttributeCategoryPlan),
  attributeModules: z.array(z.object({
    id: z.string(), path: z.string(), category: z.string(), declaredCount: z.number().int()
  })),
  diseaseModules: z.array(z.object({
    id: z.string(), path: z.string(), name: z.string()
  })),
  attributeCatalogPath: z.string().optional(),
  acceptance: z.object({
    attributesAccepted: z.number().int().default(0),
    attributesAttempted: z.number().int().default(0),
    diseasesAccepted: z.number().int().default(0),
    diseasesAttempted: z.number().int().default(0)
  }).default({ attributesAccepted: 0, attributesAttempted: 0, diseasesAccepted: 0, diseasesAttempted: 0 })
});
export type WorldRegistry = z.infer<typeof WorldRegistry>;

/** ===== Simulation core ===== */
export type Durability = "intrinsic" | "semi_durable" | "stateful";
export type AttrValue = number | string | boolean;

export type Event =
  | { t: number; type: "encounter"; payload: { kind: "PCP"|"ED"|"Inpatient"|"Specialty" } }
  | { t: number; type: "lab"; payload: { id: string; name: string; value: number; unit?: string } }
  | { t: number; type: "diagnosis"; payload: { code: string; name: string } }
  | { t: number; type: "medication"; payload: { drug: string; dose?: string } }
  | { t: number; type: "procedure"; payload: { code: string; name: string } }
  | { t: number; type: "death"; payload: {} };

export interface PatientSnapshot {
  id: string;
  birthYear: number;
  ageYears: number;
  sexAtBirth: "M"|"F"|"U";
  attributes: Record<string, AttrValue>;
  signals: Record<string, number>;
  diagnoses: Record<string, 1>;
  medsOn: Record<string, 1>;
  rngSeed: number;
}

export interface SimContext {
  now: number;
  y2t: (y: number) => number;
  rngUniform: () => number;
  rngNormal: (mean?: number, sd?: number) => number;
  emit: (e: Event) => void;
  schedule: (delayYears: number, e: Event) => void;
  get: (key: string) => number | undefined;
  set: (key: string, val: number) => void;
  attr: (id: string) => AttrValue | undefined;
  setAttr: (id: string, val: AttrValue) => void; // clamps applied by engine
  log: (msg: string) => void;
  requestLLM?: (op: string, payload: any) => Promise<any>;
}

/** ===== Attribute module contract ===== */
export type AttrLimits = { min?: number; max?: number; description?: string };
export interface AttributeSpecOut {
  value: AttrValue;
  durability: Durability;
  limits?: AttrLimits;
  description?: string;
  type?: "number" | "string" | "boolean";
}

export interface AttributeGroupModule {
  id: string;
  category: string;
  summary: string;
  generate(seed: number, birthYear: number): {
    attributes: Record<string, AttributeSpecOut>;
    signals?: Record<string, number>;
    sexAtBirth?: "M"|"F"|"U";
  };
  update?(p: PatientSnapshot, ctx: SimContext, deltaYears: number): void;
  test?(): { passed: boolean; errors?: string[]; metrics?: Record<string, number> };
}

/** ===== Disease module contract ===== */
export interface DiseaseModule {
  id: string;
  version: string;
  summary: string;
  init?(p: PatientSnapshot, ctx: SimContext): void;
  eligible(p: PatientSnapshot): boolean;
  risk(p: PatientSnapshot, ctx: SimContext): number;
  step(p: PatientSnapshot, ctx: SimContext): void;
  invariants?(): Array<{ name: string; expr: string }>;
  test?(): { passed: boolean; errors?: string[]; metrics?: Record<string, number> };
}

export const WorldFile = WorldRegistry;
export type WorldFile = WorldRegistry;
