import type { Time } from './time';

export type EventKind =
  | 'EncounterScheduled'
  | 'EncounterStarted'
  | 'EncounterFinished'
  | 'ObservationOrdered'
  | 'SpecimenCollected'
  | 'ObservationResulted'
  | 'MedicationStarted'
  | 'MedicationStopped'
  | 'ProcedurePerformed'
  | 'ConditionOnset'
  | 'ConditionResolved'
  | 'Death';

export interface BaseEvent {
  id: string;
  pid: string;
  t: Time;
  kind: EventKind;
  relatesTo?: string;
  meta?: Record<string, unknown>;
}

export type ClinicalEvent =
  | (BaseEvent & { kind: 'EncounterScheduled'; meta: { type: 'PCP' | 'ED' | 'Cardio' | 'Endo' } })
  | (BaseEvent & { kind: 'EncounterStarted'; meta: { type: 'PCP' | 'ED' | 'Cardio' | 'Endo' } })
  | (BaseEvent & { kind: 'EncounterFinished'; meta: { type: 'PCP' | 'ED' | 'Cardio' | 'Endo' } })
  | (BaseEvent & { kind: 'ObservationOrdered'; meta: { loinc: string; reason?: string } })
  | (BaseEvent & { kind: 'ObservationResulted'; meta: { loinc: string; value: number; unit: string } })
  | (BaseEvent & { kind: 'SpecimenCollected'; meta: { loinc: string } })
  | (BaseEvent & { kind: 'MedicationStarted'; meta: { rxNorm: string; dose: string } })
  | (BaseEvent & { kind: 'MedicationStopped'; meta: { rxNorm: string } })
  | (BaseEvent & { kind: 'ProcedurePerformed'; meta: { code: string } })
  | (BaseEvent & { kind: 'ConditionOnset'; meta: { icd10: string; label: string } })
  | (BaseEvent & { kind: 'ConditionResolved'; meta: { icd10: string; label: string } })
  | (BaseEvent & { kind: 'Death'; meta?: Record<string, unknown> });
