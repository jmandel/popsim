import { AttributeCategoryPlan, WorldFile } from "./contracts";
import { structuredJSON, generateTS } from "./llm";
import { categoryPlanUser, attributeModuleSystem, attributeModuleUser,
  diseaseIndexSystem, diseaseIndexUser, diseaseModuleSystem, diseaseModuleUser } from "./prompts";
import { z } from "zod";
import { isSafeModuleSource } from "./guards";

const CategoryPlanList = z.object({ categories: z.array(AttributeCategoryPlan) });
const DiseaseIndex = z.object({ diseases: z.array(z.object({ name: z.string() })) });

const MAX_ATTEMPTS = 3;
const MIN_ACCEPT_RATE = 0.7;

type AttrCatalogEntry = {
  key: string;
  type: "number"|"string"|"boolean";
  durability: "intrinsic"|"semi_durable"|"stateful";
  limits?: { min?: number; max?: number; description?: string };
  description?: string;
  category: string;
};

function scanAttrRefs(tsSource: string): Set<string> {
  const used = new Set<string>();
  const re = /ctx\.attr\((['"`])([A-Za-z0-9_]+)\1\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tsSource)) !== null) used.add(m[2]);
  return used;
}

async function tryBuildAttrModule(cat: AttributeCategoryPlan, idx: number) {
  let lastErr = "";
  for (let attempt=1; attempt<=MAX_ATTEMPTS; attempt++) {
    const ts = await generateTS(attributeModuleSystem, attributeModuleUser(cat));
    const safe = isSafeModuleSource(ts, "attr");
    if (!safe.ok) { lastErr = safe.reason ?? "unsafe"; continue; }
    const id = cat.name.replace(/[^A-Za-z0-9]+/g, "");
    const path = `out/world/attributes/${idx.toString().padStart(2,"0")}_${id}.ts`;
    await Bun.write(path, ts);
    try {
      const mod = (await import("file://" + Bun.cwd() + "/" + path)).default;
      if (typeof mod?.test === "function") {
        const t = mod.test();
        if (!t?.passed) { lastErr = "self-test failed: " + (t?.errors?.join("; ") ?? "unknown"); continue; }
      }
      return { id, path, declaredCount: cat.targetCount, category: cat.name };
    } catch (e: any) { lastErr = e?.message ?? String(e); continue; }
  }
  throw new Error(`Attribute module for ${cat.name} rejected after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

async function buildAttributeCatalog() {
  const catalog: AttrCatalogEntry[] = [];
  const files = await Bun.file("out/world").readdir({ recursive: true });
  const attrFiles = files.filter((f:any) => String(f).includes("/attributes/") && String(f).endsWith(".ts"));
  for (const p of attrFiles) {
    const rel = "out/world/attributes/" + String(p).split("/attributes/")[1];
    const mod = (await import("file://" + Bun.cwd() + "/" + rel)).default;
    const gen = mod.generate(12345, 1980);
    for (const [k, spec] of Object.entries<any>(gen.attributes)) {
      const type = (spec.type ?? (typeof spec.value === "number" ? "number" : typeof spec.value === "boolean" ? "boolean" : "string")) as "number"|"string"|"boolean";
      catalog.push({ key: k, type, durability: spec.durability, limits: spec.limits, description: spec.description, category: mod.category });
    }
  }
  await Bun.write("out/world/attribute_catalog.json", JSON.stringify({ catalog }, null, 2));
  return catalog;
}

function catalogToPromptSnippet(catalog: AttrCatalogEntry[], maxChars = 12000) {
  const rows = catalog.map(c => `${c.key} :: ${c.type}, ${c.durability}${c.limits ? `, limits[min=${c.limits.min ?? ""},max=${c.limits.max ?? ""}]` : ""}`);
  let out = "";
  for (const r of rows) { if (out.length + r.length + 1 > maxChars) break; out += r + "\n"; }
  return out;
}

async function tryBuildDiseaseModule(name: string, catalogSet: Set<string>, idx: number) {
  let lastErr = "";
  for (let attempt=1; attempt<=MAX_ATTEMPTS; attempt++) {
    const catObj = await Bun.file("out/world/attribute_catalog.json").json() as any;
    const snippet = catalogToPromptSnippet(catObj.catalog);
    const ts = await generateTS(diseaseModuleSystem, diseaseModuleUser(name, snippet));
    const safe = isSafeModuleSource(ts, "disease");
    if (!safe.ok) { lastErr = safe.reason ?? "unsafe"; continue; }
    const used = scanAttrRefs(ts);
    for (const k of used) if (!catalogSet.has(k)) { lastErr = `unknown attribute "${k}"`; break; }
    if (lastErr) { continue; }

    const id = name.replace(/[^A-Za-z0-9]+/g, "");
    const path = `out/world/diseases/${idx.toString().padStart(3,"0")}_${id}.ts`;
    await Bun.write(path, ts);
    try {
      const mod = (await import("file://" + Bun.cwd() + "/" + path)).default;
      if (typeof mod?.test === "function") {
        const t = mod.test();
        if (!t?.passed) { lastErr = "self-test failed: " + (t?.errors?.join("; ") ?? "unknown"); continue; }
      }
      return { id, path, name };
    } catch (e: any) { lastErr = e?.message ?? String(e); continue; }
  }
  throw new Error(`Disease module ${name} rejected after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

async function validateWorldQuick(world: WorldFile) {
  try {
    const { runSimulation } = await import("./sim");
    const sample = await runSimulation({ n: 50, world, llmRuntime: false });
    const eventCounts = sample.map((p:any)=>p.events.length);
    const avgEvents = eventCounts.reduce((a:number,b:number)=>a+b,0)/eventCounts.length;
    const deathFrac = sample.filter((p:any)=>p.events.some((e:any)=>e.type==="death")).length / sample.length;
    const dxCount = sample.reduce((a:number,p:any)=>a + p.events.filter((e:any)=>e.type==="diagnosis").length, 0);
    const metrics = { avgEventsPerPatient: avgEvents, deathFraction: deathFrac, diagnosisEvents: dxCount };
    await Bun.write("out/world/validation.json", JSON.stringify({ ok: true, metrics }, null, 2));
  } catch (e: any) {
    await Bun.write("out/world/validation.json", JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2));
  }
}

export async function buildWorld(seed: number, attrGroups: number, diseaseCount: number) {
  await Bun.write("out/.keep", "");
  await Bun.write("out/world/.keep", "");
  await Bun.write("out/world/attributes/.keep", "");
  await Bun.write("out/world/diseases/.keep", "");

  const categoriesObj = await structuredJSON(
    CategoryPlanList,
    "You only output JSON matching the schema.",
    `Return { "categories": [...] } for: \n${categoryPlanUser(attrGroups)}`
  );
  const categories = categoriesObj.categories;

  let attributesAttempted = 0, attributesAccepted = 0;
  const attributeModules: { id: string; path: string; category: string; declaredCount: number }[] = [];
  for (const [idx, cat] of categories.entries()) {
    attributesAttempted++;
    const m = await tryBuildAttrModule(cat, idx).catch(_ => null);
    if (m) { attributeModules.push(m); attributesAccepted++; }
  }
  if (attributeModules.length === 0) throw new Error("No attribute modules passed tests.");

  const catalog = await buildAttributeCatalog();
  const catalogSet = new Set(catalog.map(c => c.key));

  const diseaseList = await structuredJSON(DiseaseIndex, "Return JSON only.", diseaseIndexUser(diseaseCount));

  let diseasesAttempted = 0, diseasesAccepted = 0;
  const diseaseModules: { id: string; path: string; name: string }[] = [];
  for (const [i, entry] of diseaseList.diseases.entries()) {
    diseasesAttempted++;
    const mod = await tryBuildDiseaseModule(entry.name, catalogSet, i).catch(_ => null);
    if (mod) { diseaseModules.push(mod); diseasesAccepted++; }
  }

  const world: WorldFile = {
    version: "0.4",
    seed,
    model: process.env.OPENAI_MODEL_CODE ?? "gpt-4o-2024-08-06",
    categories,
    attributeModules,
    diseaseModules,
    attributeCatalogPath: "out/world/attribute_catalog.json",
    acceptance: { attributesAccepted, attributesAttempted, diseasesAccepted, diseasesAttempted }
  };
  await Bun.write("out/world/world.json", JSON.stringify(world, null, 2));

  const attrOK = attributesAccepted / Math.max(1, attributesAttempted) >= MIN_ACCEPT_RATE;
  const dzOK = diseasesAccepted / Math.max(1, diseasesAttempted) >= MIN_ACCEPT_RATE;
  if (!attrOK || !dzOK) console.warn(`[WARN] Low acceptance: attrs ${attributesAccepted}/${attributesAttempted}, diseases ${diseasesAccepted}/${diseasesAttempted}`);

  await validateWorldQuick(world);
  return world;
}
