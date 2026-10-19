import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { markdown, mp4DurationSeconds, report } from "../../scripts/media-report.mjs";

const root = mkdtempSync(join(tmpdir(), "media-report-"));
const put = (rel: string, data: Buffer | string) => {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, data);
};
// Two products sharing one identical photo, one photo with all variants, one oversized image.
put("media/a/01.jpg", "same-bytes");
put("media/b/09.jpg", "same-bytes");
put("media/a/02.jpg", "unique");
for (const w of [128, 384, 640]) put(`m/${w}/a/02.webp`, "v");
put("media/b/big.jpg", Buffer.alloc(2 * 1024 * 1024 + 1));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("media report (T5.6)", () => {
  const r = report(root);

  it("finds identical files across product folders", () => {
    expect(r.duplicates).toEqual([["a/01.jpg", "b/09.jpg"]]);
  });

  it("flags files over the per-file limit and photos without pre-sized copies", () => {
    expect(r.oversized.map((f: { path: string }) => f.path)).toEqual(["media/b/big.jpg"]);
    expect(r.missingVariants.sort()).toEqual(["a/01.jpg", "b/09.jpg", "b/big.jpg"]);
  });

  it("totals by folder and renders a summary", () => {
    expect(Object.keys(r.byFolder).sort()).toEqual(["m", "media"]);
    expect(markdown(r)).toContain("Identical files in more than one product folder: 1");
  });

  it("reads an mp4 duration from its mvhd box", () => {
    const box = Buffer.alloc(40);
    box.write("mvhd", 4);
    box[8] = 0; // version 0
    box.writeUInt32BE(1000, 20); // timescale at +16 from "mvhd"
    box.writeUInt32BE(31_000, 24); // duration
    expect(mp4DurationSeconds(box)).toBe(31);
  });
});
