"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  isAdminPageSize,
  type AdminPageSize,
} from "@/lib/validation";

/**
 * Client-side paging for the admin tables that legitimately hold their whole
 * result set in memory (inquiries, subscribers, contacts — each has a filter
 * bar and a CSV export that must cover everything, not just the visible page).
 * Paging them here keeps the DOM small without changing what those features
 * operate on. The products list is the opposite case and pages in Postgres —
 * see src/app/admin/(dashboard)/products/page.tsx.
 *
 * The chosen page size is remembered per table under `storageKey`.
 */
export function usePagedRows<T>(rows: T[], storageKey: string) {
  const [pageSize, setPageSize] = useState<AdminPageSize>(DEFAULT_ADMIN_PAGE_SIZE);
  const [page, setPage] = useState(1);

  // After mount only — localStorage doesn't exist during SSR, and reading it
  // during render would make the server and client markup disagree.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (isAdminPageSize(saved)) setPageSize(saved);
    } catch {
      // Private browsing / storage disabled — stay on the default.
    }
  }, [storageKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);

  // Filtering down to fewer pages while sitting on a high one would otherwise
  // leave `page` pointing past the end; `current` covers the render, this
  // settles the state so the next page change starts from a real page.
  useEffect(() => {
    if (page !== current) setPage(current);
  }, [page, current]);

  const paged = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );

  function changePageSize(size: number) {
    if (!isAdminPageSize(size)) return;
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      // Nothing to persist to — the choice still applies for this session.
    }
    setPageSize(size);
    setPage(1);
  }

  return { page: current, pageSize, paged, setPage, changePageSize };
}
