# Population Simulation Toolkit

This repository contains a Bun + TypeScript toolkit for synthesizing "world" definitions and generating synthetic patient trajectories. It is designed for experimenting with LLM-assisted content generation while keeping all simulation logic deterministic and inspectable.

## Project Goals

- Provide a repeatable workflow for generating attribute and disease modules with the help of a language model while enforcing safety checks before code execution.
- Offer a fast, deterministic simulator that can execute those modules and produce longitudinal patient data.
- Ship a handcrafted reference world alongside sample simulation output so the project works without external API access.

## Repository Layout

- `src/` — TypeScript sources for the CLI entry point, world builder, simulator, and LLM integration.
- `tests/` — Bun test suite that stubs the language model to validate deterministic world building.
- `worlds/handcrafted/` — Fully checked-in reference world, including attribute and disease modules, catalog metadata, and sampled patients.
- `tsconfig.json` — TypeScript configuration for Bun.

## How World Generation Works

World generation is handled by `src/world_builder.ts`. The builder orchestrates the following steps:

1. Prompt the language model for attribute category plans and disease names while constraining responses with Zod schemas.
2. Iteratively ask the model to emit TypeScript source for each attribute and disease module. Every module is statically vetted by `isSafeModuleSource` before it is imported.
3. Load the generated attribute modules to derive a catalog of attribute keys, types, durability, and numeric limits. This catalog is stored alongside the world definition.
4. Validate each module by running optional self-tests and a quick simulation smoke test to collect summary metrics.

The builder writes all artifacts into a target directory containing:

- `world.json` — world manifest describing attribute categories, module file paths, and acceptance rates.
- `attributes/` and `diseases/` — generated TypeScript modules.
- `attribute_catalog.json` — metadata about the attributes that modules produce.
- `validation.json` — metrics from a 50-patient simulation run indicating whether the world passed smoke testing.

The reference world checked into `worlds/handcrafted/` is authored manually but follows the same shape as generated worlds, so it can be loaded directly by the simulator.

## Simulation Engine Overview

`src/sim.ts` implements the event-driven patient simulator. Key features include:

- Deterministic RNG seeded from the world manifest so repeated runs produce identical populations.
- Attribute modules that seed patient state, expose helper signals, and optionally update attributes over simulated months.
- Disease modules that implement `eligible`, `init`, and `step` hooks. The simulator maintains an eligibility cache and schedules routine encounters, letting diseases emit diagnosis, medication, and death events over time.
- Automatic recording of summary metrics (average events per patient, diagnosis counts, death fraction) after each run.

Simulation output is an array of patient records, each containing static attributes, evolving signals, and a timeline of events.

## Handcrafted World & Sample Output

The `worlds/handcrafted/` directory contains a complete, human-reviewed world definition:

- `attributes/demographics.ts` and `attributes/vitals.ts` cover baseline traits and vital signs.
- `diseases/metabolic.ts` implements a metabolic syndrome progression model.
- `samples/patients.json` is a 25-patient cohort generated from this world using the simulator, and `samples/summary.json` captures aggregate metrics for the cohort.

These files make it possible to explore the simulator without calling the language model or generating new code on the fly.

## Prerequisites

- [Bun](https://bun.sh) v1.1 or later.
- Node.js-compatible environment for running TypeScript (handled by Bun).

Install dependencies once:

```sh
bun install
```

## CLI Usage

All commands are run through the Bun entry point at `src/index.ts`:

```sh
# Build a new world using the default OpenAI client
bun src/index.ts build-world --seed 123 --attrs 3 --diseases 3 --out out/world

# Simulate an existing world; add --out to capture patients to a file
bun src/index.ts simulate --world worlds/handcrafted/world.json --n 100 --out out/sim/patients.json
```

When `--out` is supplied, the simulator writes the full patient array to the specified path (creating parent directories as needed) while still printing a short summary to stdout. The simulator also saves aggregate metrics to `out/sim/summary.json` on every run.

## Running Tests

Execute the Bun test suite to exercise the world builder with a stubbed language model:

```sh
bun test
```

The tests verify that deterministic prompts and safety guards can produce a working world without reaching out to an external API.

## Extending the Project

- Modify or add attribute modules under `worlds/<your_world>/attributes/` to introduce new baseline traits.
- Author disease modules under `worlds/<your_world>/diseases/` that react to signals and emit events.
- Use the builder to scaffold new worlds, then hand-edit the generated TypeScript for additional control.

Because all modules are TypeScript files, they remain auditable and can include inline tests via exported `test()` helpers. After editing, re-run the simulator and test suite to ensure everything still passes.
