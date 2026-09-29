import { readFileSync } from "node:fs";
import type { z } from "zod";

/** Parse and validate every line; errors name the file and the real line number. */
export function readJsonl<S extends z.ZodType>(path: string, schema: S): z.infer<S>[] {
  const out: z.infer<S>[] = [];
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.trim() === "") return;
      const where = `${path}:${i + 1}`;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new Error(`${where}: invalid JSON`);
      }
      const result = schema.safeParse(json);
      if (!result.success) {
        const issues = result.error.issues.map(
          (e) => `${e.path.join(".") || "(root)"}: ${e.message}`,
        );
        throw new Error(`${where}: ${issues.join("; ")}`);
      }
      out.push(result.data);
    });
  return out;
}
