/** Minimal CSV parsing for the validation sets: quoted fields may contain commas and "". */
export function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((line) =>
      [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)]
        .slice(0, -1)
        .map((m) => (m[1] ?? "").replace(/^"|"$/g, "").replace(/""/g, '"')),
    );
}
