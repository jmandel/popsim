import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

import { AttributeCategoryPlan, WorldFile } from "./contracts";
import { LanguageModel, createOpenAILanguageModel } from "./llm";
import { isSafeModuleSource } from "./guards";
import {
  categoryPlanUser,
  attributeModuleSystem,
  attributeModuleUser,
  diseaseIndexSystem,
  diseaseIndexUser,
  diseaseModuleSystem,
  diseaseModuleUser
} from "./prompts";

const CategoryPlanList = z.object({ categories: z.array(AttributeCategoryPlan) });
const DiseaseIndex = z.object({ diseases: z.array(z.object({ name: z.string() })) });

const MAX_ATTEMPTS = 3;
const MIN_ACCEPT_RATE = 0.7;

type AttrCatalogEntry = {
  key: string;
  type: "number" | "string" | "boolean";
  durability: "intrinsic" | "semi_durable" | "stateful";
  limits?: { min?: number; max?: number; description?: string };
  description?: string;
  category: string;
};

type BuildContext = {
  worldDir: string;
  attrDir: string;
  diseaseDir: string;
  llm: LanguageModel;
};

async function listTsFiles(dir: string, relative = ""): Promise<string[]> {
  const base = relative ? join(dir, relative) : dir;
  const entries = await readdir(base, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(dir, join(relative, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(join(relative, entry.name));
    }
  }
  return files;
}

function scanAttrRefs(tsSource: string): Set<string> {
  const used = new Set<string>();
  const re = /ctx\.attr\((['"`])([A-Za-z0-9_]+)\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tsSource)) !== null) used.add(m[2]);
  return used;
}

async function tryBuildAttrModule(cat: AttributeCategoryPlan, idx: number, ctx: BuildContext) {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ts = await ctx.llm.generateTS(attributeModuleSystem, attributeModuleUser(cat));
    const safe = isSafeModuleSource(ts, "attr");
    if (!safe.ok) {
      lastErr = safe.reason ?? "unsafe";
      continue;
    }
    const id = cat.name.replace(/[^A-Za-z0-9]+/g, "");
    const filename = `${idx.toString().padStart(2, "0")}_${id}.ts`;
    const outPath = join(ctx.attrDir, filename);
    await Bun.write(outPath, ts);
    try {
      const mod = (await import("file://" + resolve(outPath))).default;
      if (typeof mod?.test === "function") {
        const t = mod.test();
        if (!t?.passed) {
          lastErr = "self-test failed: " + (t?.errors?.join("; ") ?? "unknown");
          continue;
        }
      }
      return { id, path: outPath, declaredCount: cat.targetCount, category: cat.name };
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      continue;
    }
  }
  throw new Error(`Attribute module for ${cat.name} rejected after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

async function buildAttributeCatalog(ctx: BuildContext) {
  const catalog: AttrCatalogEntry[] = [];
  const files = await listTsFiles(ctx.attrDir);
  for (const rel of files) {
    const fullPath = join(ctx.attrDir, rel);
    const mod = (await import("file://" + resolve(fullPath))).default;
    const gen = mod.generate(12345, 1980);
    for (const [k, spec] of Object.entries<any>(gen.attributes)) {
      const type = (spec.type ?? (typeof spec.value === "number"
        ? "number"
        : typeof spec.value === "boolean"
        ? "boolean"
        : "string")) as "number" | "string" | "boolean";
      catalog.push({
        key: k,
        type,
        durability: spec.durability,
        limits: spec.limits,
        description: spec.description,
        category: catCategoryFallback(mod)
      });
    }
  }
  const catalogPath = join(ctx.worldDir, "attribute_catalog.json");
  await Bun.write(catalogPath, JSON.stringify({ catalog }, null, 2));
  return { catalog, catalogPath };
}

function catCategoryFallback(mod: any): string {
  return typeof mod?.category === "string" ? mod.category : "Unknown";
}

function catalogToPromptSnippet(catalog: AttrCatalogEntry[], maxChars = 12000) {
  const rows = catalog.map(
    (c) => `${c.key} :: ${c.type}, ${c.durability}${c.limits ? `, limits[min=${c.limits.min ?? ""},max=${c.limits.max ?? ""}]` : ""}`
  );
  let out = "";
  for (const r of rows) {
    if (out.length + r.length + 1 > maxChars) break;
    out += r + "\n";
  }
  return out;
}

async function tryBuildDiseaseModule(name: string, catalogSet: Set<string>, idx: number, ctx: BuildContext) {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const catObj = await Bun.file(join(ctx.worldDir, "attribute_catalog.json")).json() as any;
    const snippet = catalogToPromptSnippet(catObj.catalog);
    const ts = await ctx.llm.generateTS(diseaseModuleSystem, diseaseModuleUser(name, snippet));
    const safe = isSafeModuleSource(ts, "disease");
    if (!safe.ok) {
      lastErr = safe.reason ?? "unsafe";
      continue;
    }
    const used = scanAttrRefs(ts);
    let unknown = "";
    for (const k of used) {
      if (!catalogSet.has(k)) {
        unknown = `unknown attribute "${k}"`;
        break;
      }
    }
    if (unknown) {
      lastErr = unknown;
      continue;
    }

    const id = name.replace(/[^A-Za-z0-9]+/g, "");
    const filename = `${idx.toString().padStart(3, "0")}_${id}.ts`;
    const outPath = join(ctx.diseaseDir, filename);
    await Bun.write(outPath, ts);
    try {
      const mod = (await import("file://" + resolve(outPath))).default;
      if (typeof mod?.test === "function") {
        const t = mod.test();
        if (!t?.passed) {
          lastErr = "self-test failed: " + (t?.errors?.join("; ") ?? "unknown");
          continue;
        }
      }
      return { id, path: outPath, name };
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      continue;
    }
  }
  throw new Error(`Disease module ${name} rejected after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

async function validateWorldQuick(world: WorldFile, worldDir: string) {
  try {
    const { runSimulation } = await import("./sim");
    const sample = await runSimulation({ n: 50, world, llmRuntime: false });
    const eventCounts = sample.map((p: any) => p.events.length);
    const avgEvents = eventCounts.reduce((a: number, b: number) => a + b, 0) / eventCounts.length;
    const deathFrac = sample.filter((p: any) => p.events.some((e: any) => e.type === "death")).length / sample.length;
    const dxCount = sample.reduce(
      (a: number, p: any) => a + p.events.filter((e: any) => e.type === "diagnosis").length,
      0
    );
    const metrics = { avgEventsPerPatient: avgEvents, deathFraction: deathFrac, diagnosisEvents: dxCount };
    await Bun.write(join(worldDir, "validation.json"), JSON.stringify({ ok: true, metrics }, null, 2));
  } catch (e: any) {
    await Bun.write(join(worldDir, "validation.json"), JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2));
  }
}

export interface BuildWorldOptions {
  seed: number;
  attributeGroups: number;
  diseaseCount: number;
  outputDir?: string;
  llm?: LanguageModel;
}

export async function buildWorld(options: BuildWorldOptions): Promise<WorldFile> {
  const worldDir = options.outputDir ?? "out/world";
  const attrDir = join(worldDir, "attributes");
  const diseaseDir = join(worldDir, "diseases");
  await mkdir(attrDir, { recursive: true });
  await mkdir(diseaseDir, { recursive: true });

  const llm = options.llm ?? createOpenAILanguageModel();
  const ctx: BuildContext = { worldDir, attrDir, diseaseDir, llm };

  const categoriesObj = await llm.structuredJSON(
    CategoryPlanList,
    "You only output JSON matching the schema.",
    `Return { "categories": [...] } for: \n${categoryPlanUser(options.attributeGroups)}`
  );
  const categories = categoriesObj.categories;

  let attributesAttempted = 0;
  let attributesAccepted = 0;
  const attributeModules: { id: string; path: string; category: string; declaredCount: number }[] = [];
  for (const [idx, cat] of categories.entries()) {
    attributesAttempted++;
    const m = await tryBuildAttrModule(cat, idx, ctx).catch(() => null);
    if (m) {
      attributeModules.push(m);
      attributesAccepted++;
    }
  }
  if (attributeModules.length === 0) throw new Error("No attribute modules passed tests.");

  const { catalog, catalogPath } = await buildAttributeCatalog(ctx);
  const catalogSet = new Set(catalog.map((c) => c.key));

  const diseaseList = await llm.structuredJSON(DiseaseIndex, "Return JSON only.", diseaseIndexUser(options.diseaseCount));

  let diseasesAttempted = 0;
  let diseasesAccepted = 0;
  const diseaseModules: { id: string; path: string; name: string }[] = [];
  for (const [i, entry] of diseaseList.diseases.entries()) {
    diseasesAttempted++;
    const mod = await tryBuildDiseaseModule(entry.name, catalogSet, i, ctx).catch(() => null);
    if (mod) {
      diseaseModules.push(mod);
      diseasesAccepted++;
    }
  }

  const world: WorldFile = {
    version: "0.4",
    seed: options.seed,
    model: Bun.env.OPENAI_MODEL_CODE ?? "gpt-4o-2024-08-06",
    categories,
    attributeModules,
    diseaseModules,
    attributeCatalogPath: catalogPath,
    acceptance: { attributesAccepted, attributesAttempted, diseasesAccepted, diseasesAttempted }
  };
  const worldPath = join(worldDir, "world.json");
  await Bun.write(worldPath, JSON.stringify(world, null, 2));

  const attrOK = attributesAccepted / Math.max(1, attributesAttempted) >= MIN_ACCEPT_RATE;
  const dzOK = diseasesAccepted / Math.max(1, diseasesAttempted) >= MIN_ACCEPT_RATE;
  if (!attrOK || !dzOK) {
    console.warn(
      `[WARN] Low acceptance: attrs ${attributesAccepted}/${attributesAttempted}, diseases ${diseasesAccepted}/${diseasesAttempted}`
    );
  }

  await validateWorldQuick(world, worldDir);
  return world;
}
