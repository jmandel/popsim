import OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const MODEL_JSON = Bun.env.OPENAI_MODEL_JSON ?? "gpt-4o-2024-08-06";
export const MODEL_CODE = Bun.env.OPENAI_MODEL_CODE ?? "gpt-4o-2024-08-06";

export const client = new OpenAI({ apiKey: Bun.env.OPENAI_API_KEY });

export async function structuredJSON<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  const jsonSchema = zodToJsonSchema(schema, "OutSchema");
  try {
    const res = await client.chat.completions.create({
      model: MODEL_JSON,
      response_format: { type: "json_schema", json_schema: { name: "OutSchema", schema: jsonSchema, strict: true } },
      temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user }]
    });
    return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
  } catch {
    const res = await client.chat.completions.create({
      model: MODEL_JSON,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: system + " Output ONLY JSON matching this schema: " + JSON.stringify(jsonSchema) },
        { role: "user", content: user }
      ]
    });
    return schema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
  }
}

export async function generateTS(system: string, user: string): Promise<string> {
  const res = await client.chat.completions.create({
    model: MODEL_CODE,
    temperature: 0.2,
    messages: [{ role: "system", content: system }, { role: "user", content: user }]
  });
  return res.choices[0]?.message?.content ?? "";
}
