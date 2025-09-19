const FORBIDDEN = [
  "import ", "require(", "fetch(", "XMLHttpRequest(", "WebSocket", "process.", "Deno.", "Bun.spawn", "Bun.serve",
  "child_process", "fs.", "globalThis", "Function(", "eval(", "while(true)", "for(;;)"
];
export function isSafeModuleSource(src: string, _kind: "attr"|"disease"): { ok: boolean; reason?: string } {
  for (const token of FORBIDDEN) {
    if (src.includes(token)) return { ok: false, reason: `Forbidden token: ${token}` };
  }
  if (!/export\s+default\s+/.test(src)) return { ok: false, reason: "Module must export default" };
  if (src.length > 60000) return { ok: false, reason: "Module too large" };
  return { ok: true };
}
