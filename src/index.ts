#!/usr/bin/env bun
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { buildWorld, BuildWorldOptions } from "./world_builder";
import { runSimulation } from "./sim";
import { WorldFile } from "./contracts";

type CLIOptions = Record<string, string | boolean>;

type ParsedArgs = {
  command: string | undefined;
  options: CLIOptions;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options: CLIOptions = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const key = token.slice(2, eqIdx);
      options[key] = token.slice(eqIdx + 1);
    } else {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return { command, options };
}

function printUsage(): void {
  console.log(`Usage:\n  bun src/index.ts build-world [--seed N --attrs N --diseases N --out DIR]\n  bun src/index.ts simulate [--world PATH --n N]`);
}

async function handleBuildWorld(options: CLIOptions) {
  const seed = Number(options.seed ?? 42);
  const attributeGroups = Number(options.attrs ?? options.attributeGroups ?? 3);
  const diseaseCount = Number(options.diseases ?? options.diseaseCount ?? 3);
  const outputDir = typeof options.out === "string" ? options.out : undefined;

  const buildOptions: BuildWorldOptions = { seed, attributeGroups, diseaseCount, outputDir };
  const world = await buildWorld(buildOptions);
  console.log(`World generated at ${outputDir ?? "out/world"}`);
  console.log(`Attribute modules: ${world.attributeModules.length}, disease modules: ${world.diseaseModules.length}`);
}

async function handleSimulate(options: CLIOptions) {
  const worldPath = typeof options.world === "string" ? options.world : "out/world/world.json";
  const n = Number(options.n ?? 100);
  const outPath = typeof options.out === "string" ? options.out : undefined;
  const explain = options.explain === true || options.explain === "true";
  const horizon = options.horizonYears ?? options.horizon;
  const horizonYears = horizon != null ? Number(horizon) : undefined;
  const data = await readFile(worldPath, "utf-8");
  const world = JSON.parse(data) as WorldFile;
  const results = await runSimulation({ n, world, explain, horizonYears });
  const summary = { patients: results.length };
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ ...summary, outPath }, null, 2));
    return;
  }
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const { command, options } = parseArgs(Bun.argv.slice(2));
  if (!command) {
    printUsage();
    return;
  }

  if (command === "build-world") {
    await handleBuildWorld(options);
    return;
  }

  if (command === "simulate") {
    await handleSimulate(options);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

void main();
