import { resolve } from "node:path";

import { isSafeModuleSource } from "./guards";

export async function writeAndLoad<T extends object>(outPath: string, source: string): Promise<T> {
  const ok = isSafeModuleSource(source, outPath.includes("/diseases/") ? "disease" : "attr");
  if (!ok.ok) throw new Error("Unsafe module source: " + ok.reason);
  await Bun.write(outPath, source);
  const mod = await import("file://" + resolve(outPath));
  return (mod as any).default ?? (mod as any);
}
