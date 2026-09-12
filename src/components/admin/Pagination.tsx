"use client";

/**
 * Page navigation for the admin list pages. Purely presentational: it renders
 * Previous / page numbers / Next plus a page-size picker and reports the
 * choice upwards — the owning table decides how that reaches the server
 * (all of them put it in the URL so a page is linkable and survives a reload).
 */

import { ADMIN_PAGE_SIZES } from "@/lib/validation";
import { pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Plural noun for the count line, e.g. "product". */
  itemLabel?: string;
  disabled?: boolean;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel = "item",
  disabled = false,
}: Props) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);

  const buttonClass =
    "min-w-9 rounded-sm border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <label htmlFor="admin-page-size">Show</label>
        <select
          id="admin-page-size"
          value={pageSize}
          disabled={disabled}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-sm border border-input bg-background px-2 py-1 text-xs text-foreground"
        >
          {ADMIN_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span>
          per page · {first}–{last} of {total} {itemLabel}
          {total === 1 ? "" : "s"}
        </span>
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            className={buttonClass}
            onClick={() => onPageChange(current - 1)}
            disabled={disabled || current <= 1}
          >
            Previous
          </button>
          {pageWindow(current, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                aria-current={n === current ? "page" : undefined}
                className={cn(
                  buttonClass,
                  n === current && "border-primary bg-primary text-primary-foreground hover:bg-primary",
                )}
                onClick={() => onPageChange(n)}
                disabled={disabled}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            className={buttonClass}
            onClick={() => onPageChange(current + 1)}
            disabled={disabled || current >= pageCount}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
