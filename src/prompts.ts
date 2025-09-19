import { AttributeCategoryPlan } from "./contracts";

export const categoryPlanUser = (count: number) =>
  `Design ${count} attribute categories covering demographics, vitals, and disease risk factors. ` +
  `Each category should have a name, description, targetCount, and durability mix with values between 0 and 1.`;

export const attributeModuleSystem =
  "You are a medical data module generator. Return a complete TypeScript module exporting a default object that matches the AttributeGroupModule interface.";

export const attributeModuleUser = (category: AttributeCategoryPlan) =>
  `Write a module for attribute category "${category.name}". ` +
  `It should produce ${category.targetCount} attributes consistent with the description: ${category.description}. ` +
  "Use only deterministic math utilities, avoid network access, and respect the declared durability mix.";

export const diseaseIndexSystem =
  "Return JSON listing diseases that should exist in a synthetic population health simulation.";

export const diseaseIndexUser = (count: number) =>
  `Provide ${count} disease names relevant to outpatient and chronic care.`;

export const diseaseModuleSystem =
  "You are a medical disease simulation module generator. Output a valid TypeScript module exporting a DiseaseModule implementation.";

export const diseaseModuleUser = (name: string, catalogSnippet: string) =>
  `Generate a disease module named "${name}". ` +
  "Use attributes from the catalog below to determine eligibility, risk, and simulation logic. " +
  "Catalog:\n" + catalogSnippet;
