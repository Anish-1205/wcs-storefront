import { describe, expect, it } from "vitest";
import { classifyGroupCollection } from "@/lib/import/collection-classification";
import { nullAiProvider } from "@/lib/ai/null-provider";
import fixture from "./fixtures/collection-classification-eval.json";

/**
 * Evaluation fixture built from the collections actually seeded in
 * supabase/migrations/003_seed_sample_data.sql. Runs the deterministic
 * (alias-based) classification path — the AI provider is deliberately the
 * null provider here, so this test proves the non-AI path alone is safe:
 * it must never guess a collection for the ambiguous case, and must land
 * exactly on the verified collection for the clear cases.
 */
describe("collection classification eval fixture", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, async () => {
      const result = await classifyGroupCollection({
        adminDescription: testCase.adminDescription,
        folderOrFilenameHint: null,
        batchManifestCollectionId: null,
        trustedManifestMap: null,
        aliases: fixture.aliases,
        existingCollections: fixture.collections,
        imageUrls: [],
        aiProvider: nullAiProvider,
      });

      if (testCase.expectedSlug === null) {
        expect(result.state).toBe("unresolved");
        expect(result.collection_id).toBeNull();
      } else {
        const expected = fixture.collections.find((c) => c.slug === testCase.expectedSlug);
        expect(result.state).toBe("confirmed");
        expect(result.collection_id).toBe(expected?.id);
      }
    });
  }
});
