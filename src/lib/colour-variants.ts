/**
 * Colour-variant helpers shared by the offline extraction script
 * (scripts/extract-colour-variants.mjs) and the storefront runtime
 * (src/data/products.ts, ColourVariantRow).
 *
 * "Nothing is invented": a derived swatch is only ever a plain colour name +
 * an optional hex, read off a folded-assortment photo the business itself
 * supplied. No weave / fabric / region / price / availability is attached to a
 * derived colourway — those have no verified source.
 */

/** Words that must never appear in a derived colour label — they'd smuggle an
 *  unverified weave / fibre / region claim in through the colour field. */
export const BANNED_COLOUR_TOKENS = [
  "silk",
  "banarasi",
  "benarasi",
  "patola",
  "tissue",
  "bandhej",
  "bandhani",
  "ikat",
  "paithani",
  "kanjivaram",
  "kanchipuram",
  "georgette",
  "munga",
  "khaddi",
  "zari",
  "crepe",
  "modal",
  "kota",
  "jamdani",
  "tanchoi",
  "chiffon",
  "organza",
  "cotton",
  "linen",
  "handloom",
] as const;

export interface DerivedColour {
  /** plain colour word, lowercase — e.g. "wine", "bottle green" */
  name: string;
  /** "#rrggbb" or null when no confident hex */
  hex: string | null;
}

/** Raw per-slug shape stored in public/media/colour-variants.json. */
export interface ColourVariantEntry {
  /** the colour-range image file names this was derived from */
  images: string[];
  colours: DerivedColour[];
}

export type ColourVariantsFile = Record<string, ColourVariantEntry>;

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Normalise + guard a list of model-proposed colours: lowercase, trim, drop
 * anything carrying a banned token, drop blanks, dedupe by name, cap the count.
 * Pure — used identically in the build script and (defensively) at runtime.
 */
export function sanitiseDerivedColours(
  input: Array<{ name?: unknown; hex?: unknown }>,
  max = 16,
): DerivedColour[] {
  const seen = new Set<string>();
  const out: DerivedColour[] = [];

  for (const raw of input) {
    if (out.length >= max) break;
    const name = String(raw?.name ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (name.length < 2 || name.length > 40) continue;
    if (BANNED_COLOUR_TOKENS.some((t) => name.includes(t))) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const hexRaw = typeof raw?.hex === "string" ? raw.hex.trim() : "";
    const hex = HEX_RE.test(hexRaw) ? hexRaw.toLowerCase() : null;
    out.push({ name, hex });
  }

  return out;
}

/** Title-case a derived colour name for display ("bottle green" → "Bottle Green"). */
export function displayColourName(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}
