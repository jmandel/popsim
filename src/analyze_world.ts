#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

import { runSimulation } from "./sim";
import { WorldFile, Event } from "./contracts";

type DiseaseConfig = {
  label: string;
  codes: string[];
  labIds: string[];
  medications: string[];
  encounterKinds?: Array<"PCP" | "ED" | "Inpatient" | "Specialty">;
  extra?: (patient: SimPatientView, events: Event[]) => Record<string, number | Record<string, number>>;
};

type SimPatientView = {
  id: string;
  attrs: Record<string, number | string | boolean>;
  events: Event[];
};

type SummaryRow = {
  diagnosed: number;
  diagnosisRate: number;
  meanDiagnosisAge: number | null;
  labs: Record<string, { mean: number; count: number }>;
  medicationCoverage: Record<string, number>;
  encounterRate?: Record<string, number>;
  extra?: Record<string, number | Record<string, number>>;
};

const diseases: Record<string, DiseaseConfig> = {
  diabetes: {
    label: "Type 2 Diabetes Mellitus",
    codes: ["E11.9"],
    labIds: ["A1C", "FPG"],
    medications: ["Metformin", "Semaglutide", "Lisinopril"],
    encounterKinds: ["Specialty"]
  },
  cad: {
    label: "Coronary Artery Disease",
    codes: ["I25.10"],
    labIds: ["LIPID_LDL", "LIPID_HDL", "LIPID_TG"],
    medications: ["Atorvastatin", "Simvastatin", "Aspirin", "Rosuvastatin", "Ezetimibe"],
    encounterKinds: ["ED", "Inpatient", "Specialty"],
    extra: (_patient, events) => {
      const interventions = events.filter((e) => e.type === "procedure" && (e.payload.name.includes("angi") || e.payload.name.includes("coronary")));
      return { revascularizationEvents: interventions.length };
    }
  },
  copd: {
    label: "Chronic Obstructive Pulmonary Disease",
    codes: ["J44.9"],
    labIds: ["SPIRO_FEV1"],
    medications: ["Tiotropium inhaler", "Albuterol inhaler", "Budesonide-formoterol", "Home oxygen"],
    encounterKinds: ["ED", "Inpatient"]
  },
  ckd: {
    label: "Chronic Kidney Disease",
    codes: ["N18.3", "N18.4", "N18.5"],
    labIds: ["LAB_EGFR", "LAB_CREAT", "LAB_UACR"],
    medications: ["Lisinopril", "Empagliflozin", "Erythropoietin"],
    encounterKinds: ["Specialty"],
    extra: (patient) => {
      const egfr = typeof patient.attrs.EGFR === "number" ? (patient.attrs.EGFR as number) : null;
      const stage = egfr == null ? "unknown" : egfr >= 60 ? "2" : egfr >= 45 ? "3a" : egfr >= 30 ? "3b" : egfr >= 15 ? "4" : "5";
      return { stageDistribution: { [stage]: 1 } };
    }
  },
  mdd: {
    label: "Major Depressive Disorder",
    codes: ["F33.1"],
    labIds: ["PHQ9"],
    medications: ["Sertraline", "Bupropion"],
    encounterKinds: ["Specialty"],
    extra: (_patient, events) => {
      const therapy = events.filter((e) => e.type === "procedure" && e.payload.name.includes("Psychotherapy"));
      return { psychotherapySessions: therapy.length };
    }
  }
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summarizeDisease(patients: SimPatientView[], cfg: DiseaseConfig, total: number): SummaryRow {
  const diagnosedPatients = patients.filter((p) =>
    p.events.some((e) => e.type === "diagnosis" && cfg.codes.includes(e.payload.code))
  );
  const diagCount = diagnosedPatients.length;
  const diagnosisAges: number[] = [];
  const labStats: Record<string, { mean: number; count: number }> = {};
  const medCoverage: Record<string, number> = {};
  const encounterRate: Record<string, number> = {};
  const extraSummaries: Record<string, number | Record<string, number>> = {};

  for (const med of cfg.medications) {
    medCoverage[med] = 0;
  }
  if (cfg.encounterKinds) {
    for (const kind of cfg.encounterKinds) encounterRate[kind] = 0;
  }

  for (const patient of diagnosedPatients) {
    const ageBase = typeof patient.attrs.AGE_YEARS === "number" ? (patient.attrs.AGE_YEARS as number) : 0;
    const diagEvent = patient.events.find((e) => e.type === "diagnosis" && cfg.codes.includes(e.payload.code));
    if (diagEvent) diagnosisAges.push(ageBase + diagEvent.t);
    const followYears = Math.max(1, patient.events.length ? patient.events[patient.events.length - 1].t : 0);

    const lastLabs: Record<string, number> = {};
    for (const event of patient.events) {
      if (event.type === "lab" && cfg.labIds.includes(event.payload.id)) {
        lastLabs[event.payload.id] = event.payload.value;
      }
    }
    for (const [labId, value] of Object.entries(lastLabs)) {
      if (!labStats[labId]) labStats[labId] = { mean: 0, count: 0 };
      labStats[labId].mean += value;
      labStats[labId].count += 1;
    }

    const meds = new Set(
      patient.events.filter((e) => e.type === "medication" && cfg.medications.includes(e.payload.drug)).map((e) => e.payload.drug)
    );
    for (const med of meds) {
      medCoverage[med] = (medCoverage[med] ?? 0) + 1;
    }

    if (cfg.encounterKinds) {
      const counts: Record<string, number> = {};
      for (const kind of cfg.encounterKinds) counts[kind] = 0;
      for (const event of patient.events) {
        if (event.type === "encounter" && cfg.encounterKinds.includes(event.payload.kind)) {
          counts[event.payload.kind] += 1;
        }
      }
      for (const [kind, value] of Object.entries(counts)) {
        encounterRate[kind] = (encounterRate[kind] ?? 0) + value / followYears;
      }
    }

    if (cfg.extra) {
      const extra = cfg.extra(patient, patient.events);
      for (const [key, value] of Object.entries(extra)) {
        const existing = extraSummaries[key];
        if (typeof value === "number") {
          extraSummaries[key] = (typeof existing === "number" ? (existing as number) : 0) + value;
        } else {
          const current = typeof existing === "object" && existing != null ? (existing as Record<string, number>) : {};
          const next = extraSummaries as Record<string, Record<string, number>>;
          const incoming = value as Record<string, number>;
          const merged: Record<string, number> = { ...current };
          for (const [k, v] of Object.entries(incoming)) {
            merged[k] = (merged[k] ?? 0) + v;
          }
          next[key] = merged;
        }
      }
    }
  }

  const summary: SummaryRow = {
    diagnosed: diagCount,
    diagnosisRate: total ? diagCount / total : 0,
    meanDiagnosisAge: mean(diagnosisAges),
    labs: {},
    medicationCoverage: {},
    encounterRate: cfg.encounterKinds ? {} : undefined,
    extra: Object.keys(extraSummaries).length ? extraSummaries : undefined
  };

  for (const [labId, stat] of Object.entries(labStats)) {
    summary.labs[labId] = {
      mean: stat.count ? stat.mean / stat.count : 0,
      count: stat.count
    };
  }

  for (const [med, count] of Object.entries(medCoverage)) {
    summary.medicationCoverage[med] = diagCount ? count / diagCount : 0;
  }

  if (summary.encounterRate) {
    for (const [kind, count] of Object.entries(encounterRate)) {
      summary.encounterRate[kind] = diagCount ? count / diagCount : 0;
    }
  }

  if (summary.extra) {
    for (const [key, value] of Object.entries(summary.extra)) {
      if (typeof value === "number") {
        summary.extra[key] = diagCount ? Number(value / diagCount) : 0;
      } else {
        const record = value as Record<string, number>;
        const normalized: Record<string, number> = {};
        for (const [stage, count] of Object.entries(record)) {
          normalized[stage] = diagCount ? count / diagCount : 0;
        }
        summary.extra[key] = normalized;
      }
    }
  }

  return summary;
}

async function main() {
  const args = new Map<string, string>();
  for (let i = 2; i < Bun.argv.length; i++) {
    const token = Bun.argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = Bun.argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, "true");
      }
    }
  }

  const worldPath = args.get("world") ?? "worlds/clinical_suite/world.json";
  const n = Number(args.get("n") ?? 200);
  const worldData = await readFile(worldPath, "utf-8");
  const world = JSON.parse(worldData) as WorldFile;

  const patientsRaw = await runSimulation({ n, world });
  const patients: SimPatientView[] = patientsRaw.map((p: any) => ({ id: p.id, attrs: p.attrs, events: p.events }));
  const totalEvents = patients.reduce((sum, p) => sum + p.events.length, 0);
  const encounterCounts = patients.map((p) => p.events.filter((e) => e.type === "encounter").length);

  const diseaseSummaries: Record<string, SummaryRow> = {};
  for (const [key, cfg] of Object.entries(diseases)) {
    diseaseSummaries[key] = summarizeDisease(patients, cfg, patients.length);
  }

  const output = {
    patients: patients.length,
    avgEventsPerPatient: totalEvents / Math.max(1, patients.length),
    avgEncounterPerPatient: encounterCounts.reduce((a, b) => a + b, 0) / Math.max(1, encounterCounts.length),
    diseaseSummaries
  };

  console.log(JSON.stringify(output, null, 2));
}

await main();
