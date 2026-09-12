/**
 * Which page numbers the admin pagination control renders, with `null`
 * standing for a gap ("…").
 *
 * Always shows the first and last page plus a window around the current one,
 * so the control stays roughly the same width whether there are 3 pages or
 * 300. Lives here rather than in Pagination.tsx so it can be unit-tested —
 * the vitest setup doesn't transform JSX.
 */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const window = new Set<number>([1, pageCount, page, page - 1, page + 1]);
  // Keep the run next to whichever end we're at, so the control doesn't
  // collapse to "1 … 3 … 20" when the user is near the start or finish.
  if (page <= 3) [2, 3, 4].forEach((n) => window.add(n));
  if (page >= pageCount - 2) {
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => window.add(n));
  }

  const pages = [...window].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);

  const withGaps: Array<number | null> = [];
  let previous = 0;
  for (const n of pages) {
    if (previous && n - previous > 1) withGaps.push(null);
    withGaps.push(n);
    previous = n;
  }
  return withGaps;
}
