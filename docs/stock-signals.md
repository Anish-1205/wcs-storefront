# Stock signals

In **Admin → Products**, choose a stock signal on a product row. It saves
automatically. The Default option shows the availability that will be restored.
Custom overrides show their actual status and note. Signals affect the customer
catalogue independently of Draft / Published / Archived visibility.

Each row has its own save feedback, Retry after failed saves, and History.
History records the verified administrator, time, and before/after values for
changes made after migration 022. Undo restores the previous override (including
the absence of an override). An undo is rejected if a newer change exists.

Select products with the checkboxes, choose a bulk signal, and click **Apply to
selected**. Selection is limited to the current page (maximum 100 products) and
clears when filters, sort, or pagination change. Bulk updates and bulk undo are
transactional: either every selected change succeeds or none does. Failed bulk
updates retain the selection for retry. The stock-signal filter matches saved
overrides across the entire result set before pagination; it does not filter
products by their inherited default availability.

The separate Storefront Signals page uses the same editor and displays genuine
catalogue defaults, before overrides are applied. If signals cannot be loaded,
editing those signals is disabled until a successful refresh. Other product
editing remains available on the unfiltered Products page.

Migration `022_availability_history.sql` adds database triggers that move
signals/history when a product slug changes and remove its override on deletion.
Deleted-product history is retained for audit but is no longer eligible for undo.
History is private; only the admin server's service-role client can read it or
call the transactional write function. No customer product data is changed by
applying the migration.

If a storefront availability lookup fails, the response uses Availability on
Request (and retains a catalogue Sold state) instead of claiming default stock
is available. A successful cached snapshot can continue to serve during cache
revalidation.

## Verification

`npm test`, `npm run types`, and `npm run lint` cover local regression checks.
`scripts/verify-availability.sql` runs database lifecycle, undo, permissions, and
atomicity assertions inside a rolled-back transaction.

The opt-in browser smoke test uses the configured database and an existing admin
allowlisted in `ADMIN_EMAILS`. It creates a short-lived session without sending
email, creates two uniquely named **draft** products, and deletes them in a
`finally` block. It never changes an existing product. On PowerShell:

```powershell
$env:SIGNAL_SMOKE='1'
node --env-file=.env.local node_modules/@playwright/test/cli.js test --config playwright.signals.config.ts
```

The test checks saved values after reload, default labels, history, undo, bulk
updates, server-side filtering, network-error rollback/retry, rename persistence,
mobile access to the control, and cleanup. Trace recording is disabled to avoid
storing the authenticated session. If a process is forcibly terminated before
cleanup, its draft fixture names start with `signal-smoke-`.

Set `SIGNAL_BASE_URL` to the trusted deployed storefront URL to run the same
checks against that deployment without starting a local Next.js server.
