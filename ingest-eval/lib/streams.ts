import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Stream } from "./replay";

const DIR = join(process.cwd(), "ingest-eval", "fixtures");
const FIRST = ["F1", "F2", "F3F4", "F3F4_long", "F4", "F5", "MEDIA_ONLY", "DF1", "DF_late", "DF_two", "DF_ambiguous", "LATE_TEXT", "TIE_DF", "TIE_PF", "PF1", "PF_late"];

/** Fixture streams, the five real-world shapes first. INGEST_ONLY=F1,F4 narrows the run. */
export function loadStreams(): Stream[] {
  const only = (process.env.INGEST_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Stream);
  const rank = (name: string) => (FIRST.includes(name) ? FIRST.indexOf(name) : FIRST.length);
  return all
    .filter((s) => !only.length || only.includes(s.name))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
