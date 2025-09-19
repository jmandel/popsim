export function toFHIRLite(patient: any) {
  const patientR = {
    resourceType: "Patient",
    id: patient.id,
    birthDate: `${patient.birthYear}-01-01`
  };
  const observations = patient.events
    .filter((e:any)=>e.type==="lab")
    .map((e:any, idx:number)=>({
      resourceType: "Observation",
      id: `${patient.id}-obs-${idx}`,
      status: "final",
      code: { text: e.payload.name },
      valueQuantity: { value: e.payload.value, unit: e.payload.unit },
      effectiveDateTime: isoAtOffset(patient.birthYear, e.t)
    }));
  const conditions = patient.events
    .filter((e:any)=>e.type==="diagnosis")
    .map((e:any, idx:number)=>({
      resourceType: "Condition",
      id: `${patient.id}-cond-${idx}`,
      code: { text: e.payload.name },
      onsetDateTime: isoAtOffset(patient.birthYear, e.t)
    }));
  return { patient: patientR, observations, conditions };
}
function isoAtOffset(birthYear:number, tYears:number) {
  const y = birthYear + Math.floor(tYears);
  return `${y}-07-01";
}
