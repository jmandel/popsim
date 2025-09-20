export function toFHIRLite(patient: any) {
  const patientR = {
    resourceType: "Patient",
    id: patient.id,
    birthDate: `${patient.birthYear}-01-01`
  };
  const events = Array.isArray(patient.events) ? patient.events : [];
  const observations = events
    .filter((e: any) => e.kind === 'ObservationResulted')
    .map((e: any, idx: number) => ({
      resourceType: "Observation",
      id: `${patient.id}-obs-${idx}`,
      status: "final",
      code: { text: e.meta?.loinc ?? "" },
      valueQuantity: { value: e.meta?.value, unit: e.meta?.unit ?? "" },
      effectiveDateTime: isoAtOffset(patient.birthYear, e.t)
    }));
  const conditions = events
    .filter((e: any) => e.kind === 'ConditionOnset')
    .map((e: any, idx: number) => ({
      resourceType: "Condition",
      id: `${patient.id}-cond-${idx}`,
      code: { text: e.meta?.label ?? e.meta?.icd10 ?? "" },
      onsetDateTime: isoAtOffset(patient.birthYear, e.t)
    }));
  return { patient: patientR, observations, conditions };
}
function isoAtOffset(birthYear: number, tDays: number) {
  const base = new Date(Date.UTC(birthYear, 0, 1));
  const days = Math.round(Number.isFinite(tDays) ? tDays : 0);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
