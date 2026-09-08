/**
 * Offline AI step: read the folded "colour-range" assortment photos in
 * public/media/<slug>/ and extract the distinct body colours each design is
 * made in, writing public/media/colour-variants.json.
 *
 *   { "<slug>": { "images": ["06-colour-range.jpg"], "colours": [ {"name":"wine","hex":"#7b2b3a"}, ... ] } }
 *
 * src/data/products.ts reads this to render the derived colour-variant swatches
 * on the product page (ColourVariantRow). A derived swatch is ONLY a colour
 * name + optional hex — never a price, weave, fibre or region (see
 * src/lib/colour-variants.ts, "nothing is invented").
 *
 * Run:  node scripts/extract-colour-variants.mjs
 *       node scripts/extract-colour-variants.mjs <slug> [<slug> ...]   (subset)
 *
 * Needs ANTHROPIC_API_KEY (auto-loaded from .env.local if present). With no key
 * the script logs and exits 0 without touching the existing JSON. A per-slug
 * failure keeps that slug's previous entry.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const MEDIA = path.join(process.cwd(), "public", "media");
const OUT = path.join(MEDIA, "colour-variants.json");
const MODEL = process.env.ANTHROPIC_COLOUR_MODEL || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_IMAGES = 4;
const MAX_COLOURS = 16;

// Mirror of src/lib/colour-variants.ts — keep in sync. (mjs can't import the .ts.)
const BANNED_COLOUR_TOKENS = [
  "silk", "banarasi", "benarasi", "patola", "tissue", "bandhej", "bandhani",
  "ikat", "paithani", "kanjivaram", "kanchipuram", "georgette", "munga",
  "khaddi", "zari", "crepe", "modal", "kota", "jamdani", "tanchoi", "chiffon",
  "organza", "cotton", "linen", "handloom",
];
const HEX_RE = /^#[0-9a-f]{6}$/i;

function sanitiseDerivedColours(input, max = MAX_COLOURS) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (out.length >= max) break;
    const name = String(raw?.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 40) continue;
    if (BANNED_COLOUR_TOKENS.some((t) => name.includes(t))) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const hexRaw = typeof raw?.hex === "string" ? raw.hex.trim() : "";
    out.push({ name, hex: HEX_RE.test(hexRaw) ? hexRaw.toLowerCase() : null });
  }
  return out;
}

async function loadEnvLocal() {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const txt = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {
    /* no .env.local — fine */
  }
}

const SYSTEM_PROMPT = `You are shown one or more photos of the SAME saree design folded and stacked in many different body colours (a colour-range / assortment shot).

List the distinct body colours you can clearly see, so a shopper knows which shades this design comes in.

Hard rules:
- Plain, ordinary colour words only — e.g. "wine", "bottle green", "mustard", "peach", "black". Two words maximum.
- NEVER name a fabric, fibre, weave, region, technique or authenticity (no "silk", "banarasi", "patola", "tissue", "zari", "handloom", ...). Colour only.
- Skip a fold if you cannot confidently tell its colour.
- At most ${MAX_COLOURS} colours. Deduplicate near-identical shades.
- "hex" is your best guess at the fold's dominant colour as #rrggbb, or null.
- Respond with ONLY this JSON, no prose, no markdown fences:
{"colours":[{"name":"wine","hex":"#7b2b3a"},{"name":"mustard","hex":"#c99a2e"}]}`;

async function callAnthropic(apiKey, imageBlocks) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: "Extract the colours." }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`  anthropic request failed (${res.status})`);
      return null;
    }
    const data = await res.json();
    const text = data.content?.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const cleaned = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("  anthropic request errored:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function imageBlock(file) {
  const buf = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: buf.toString("base64") },
  };
}

async function findColourRangeBySlug() {
  const bySlug = {};
  for (const entry of await fs.readdir(MEDIA, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = (await fs.readdir(path.join(MEDIA, entry.name)))
      .filter((f) => /colour-range/i.test(f) && /\.(jpe?g|png)$/i.test(f))
      .sort();
    if (files.length) bySlug[entry.name] = files;
  }
  return bySlug;
}

async function main() {
  await loadEnvLocal();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(OUT, "utf8"));
  } catch {
    /* first run */
  }

  const bySlug = await findColourRangeBySlug();
  const only = process.argv.slice(2);
  const slugs = (only.length ? only : Object.keys(bySlug)).filter((s) => bySlug[s]);

  if (!apiKey) {
    console.warn(
      "ANTHROPIC_API_KEY not set — skipping extraction, leaving colour-variants.json untouched.",
    );
    if (!Object.keys(existing).length) {
      await fs.writeFile(OUT, "{}\n");
      console.log("Wrote empty public/media/colour-variants.json");
    }
    return;
  }

  const result = { ...existing };
  for (const slug of slugs) {
    const files = bySlug[slug];
    process.stdout.write(`${slug} (${files.join(", ")}) ... `);
    const blocks = await Promise.all(
      files.slice(0, MAX_IMAGES).map((f) => imageBlock(path.join(MEDIA, slug, f))),
    );
    const raw = await callAnthropic(apiKey, blocks);
    const colours = sanitiseDerivedColours(raw?.colours);
    if (!colours.length) {
      console.log("no colours — keeping previous entry");
      continue;
    }
    result[slug] = { images: files, colours };
    console.log(`${colours.length}: ${colours.map((c) => c.name).join(", ")}`);
  }

  await fs.writeFile(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nWrote public/media/colour-variants.json (${Object.keys(result).length} designs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
