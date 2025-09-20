export type Sex = 'F' | 'M';

export interface Attributes {
  readonly ageYr: number;
  readonly sex: Sex;
  readonly bmi: number;
  readonly smoker: boolean;
  readonly sbp?: number;
  readonly a1c?: number;
  readonly [key: string]: unknown;
}

export interface DiseaseStateMap {
  readonly [diseaseId: string]: string;
}

export interface Snapshot {
  readonly attrs: Attributes;
  readonly diseases: DiseaseStateMap;
}
