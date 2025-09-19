import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface LanguageModel {
  structuredJSON<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T>;
  generateTS(system: string, user: string): Promise<string>;
}

const DEFAULT_JSON_MODEL = Bun.env.OPENAI_MODEL_JSON ?? "gpt-4o-2024-08-06";
const DEFAULT_CODE_MODEL = Bun.env.OPENAI_MODEL_CODE ?? "gpt-4o-2024-08-06";

class OpenAILanguageModel implements LanguageModel {
  private readonly client: OpenAI;
  private readonly jsonModel: string;
  private readonly codeModel: string;

  constructor(options?: { apiKey?: string; jsonModel?: string; codeModel?: string }) {
    const apiKey = options?.apiKey ?? Bun.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY must be set to use the OpenAI language model.");
    }
    this.client = new OpenAI({ apiKey });
    this.jsonModel = options?.jsonModel ?? DEFAULT_JSON_MODEL;
    this.codeModel = options?.codeModel ?? DEFAULT_CODE_MODEL;
  }

  async structuredJSON<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
    const jsonSchema = zodToJsonSchema(schema, "OutSchema");
    try {
      const res = await this.client.chat.completions.create({
        model: this.jsonModel,
        response_format: { type: "json_schema", json_schema: { name: "OutSchema", schema: jsonSchema, strict: true } },
        temperature: 0.2,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      });
      return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    } catch {
      const fallback = await this.client.chat.completions.create({
        model: this.jsonModel,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: system + " Output ONLY JSON matching this schema: " + JSON.stringify(jsonSchema) },
          { role: "user", content: user }
        ]
      });
      return schema.parse(JSON.parse(fallback.choices[0]?.message?.content ?? "{}"));
    }
  }

  async generateTS(system: string, user: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.codeModel,
      temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    });
    return res.choices[0]?.message?.content ?? "";
  }
}

export function createOpenAILanguageModel(options?: {
  apiKey?: string;
  jsonModel?: string;
  codeModel?: string;
}): LanguageModel {
  return new OpenAILanguageModel(options);
}
