/**
 * A group still needs the AI pipeline if it never got AI metadata, or never
 * got a collection classification at all — re-running never overwrites an
 * admin-confirmed classification (see requestGroupCollectionClassification in
 * import-actions.ts), so it's always safe to include already-classified-by-admin
 * groups here too.
 */
export function selectPendingGroupIds(
  groups: Array<{ id: string; ai_generated_at: string | null }>,
  classifiedGroupIds: Set<string>,
): string[] {
  return groups.filter((g) => !g.ai_generated_at || !classifiedGroupIds.has(g.id)).map((g) => g.id);
}
