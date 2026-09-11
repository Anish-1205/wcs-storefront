# Website page editing and mobile storefront

## Enable publishing

1. Apply any outstanding database migrations in order. On a project already at migration 016, run [017_storefront_page_content.sql](../supabase/migrations/017_storefront_page_content.sql) and then [018_page_content_drafts.sql](../supabase/migrations/018_page_content_drafts.sql) once in the Supabase SQL Editor.
2. Deploy this revision with the existing Supabase and Cloudinary environment variables.
3. Sign in at `/admin` and open **Website pages** (`/admin/pages`).
4. Make a small text change, check the preview beside the form, and select **Make it live on the website**. Verify the public page in a separate tab. **Go back to an earlier version** restores the previous published copy.

Migration 018 adds a `draft_content` column (saved work that is not published) and a `storefront_page_content_versions` table holding the last 10 published versions per page. Drafts and version history are admin-only: public roles hold column-level `select` on `page`, `content` and `updated_at`, and no grant at all on the versions table. Migration 017 creates the published-content table with public read access and no public write policy. Writes use the server-only service-role client after `assertAdmin` verifies the session and email allowlist. No new environment variables are required. If the table is unavailable, the editor disables publishing and public pages retain their authored defaults.

Migrations 017 and 018 have been prepared but were **not applied to the remote database** during implementation. Live publishing still needs the setup and smoke check above. Supabase API credentials alone cannot apply SQL migrations.

## Everyday editing

### Public text, images and sections

The editor is written for a non-technical owner: every control is labelled in ordinary words, and no code identifiers (region names, field keys, slugs) appear in the interface.

- Choose a page from **Which page do you want to change?**. Page names are plain ("All sarees", "Enquiry list", "Saree page: …").
- Editable items are grouped into expandable cards named after what a visitor sees — "Homepage banner", "Top menu bar", "Page footer", "Enquiry form" — instead of one flat list. Cards fed by `ContentRegion` names map through `REGION_LABELS` in [src/lib/page-content.ts](../src/lib/page-content.ts); add an entry there when a new region is introduced, or its raw component name is shown as a fallback.
- Filter chips (**Everything / Just words / Just pictures / Show or hide parts**) and a search box narrow the list.
- Every field carries an inline hint describing what it does and roughly how long it should be (`fieldHint`), plus a live character count.
- Pictures use a drop zone: drag a photo onto it, or click to pick one. The thumbnail updates as soon as the upload finishes. Non-image files are refused with a plain message.
- Show/hide controls are labelled switches reading "This part is showing on your website" or "This part is hidden from visitors", with a matching Show it / Hide it action.
- The preview sits beside the form on wide screens and updates as you type. Below 1280px the screen switches to **Make changes** / **See preview** tabs fixed to the bottom of the viewport, so the editor is usable on a phone or tablet.

### Saving, publishing and undo

Three distinct actions, each explained in the interface:

| Control | Effect |
| --- | --- |
| **Make it live on the website** | Publishes the current content. Snapshots the previously published version, writes `content` and `draft_content`, and invalidates the public caches. |
| **Save for later, don’t publish yet** | Writes `draft_content` only. Visitors keep seeing the published version and no cache tag is invalidated. The draft reloads into the editor next visit. |
| **Undo my changes** | Discards edits made since the last save, in the browser only. |
| **Put the original back** (per field) | Removes that one override so the authored default returns. |
| **Go back to an earlier version** | Lists the last 10 published versions with timestamps and restores one after a confirmation step. The version being replaced is itself snapshotted first, so a restore is also reversible. |

`savePageDraft`, `publishPageContent` and `restorePageVersion` in [src/app/admin/page-content-actions.ts](../src/app/admin/page-content-actions.ts) all run behind `assertAdmin` and validate with the same Zod schemas as before. Only publish and restore call `revalidateTag("storefront-pages")`.

### Homepage layout

**How your homepage is arranged** groups its controls into cards — welcome banner, the sarees you are showing off, the order of the page, homepage wording, and the order of the rest of the shelf — with saree thumbnails next to every picker and the same switch styling for visibility. Use it to choose the welcome saree, up to four featured sarees, section visibility/order, homepage headings, and shelf order. The welcome saree cannot also occupy a featured position. Hiding welcome or featured sections returns their products to the shelf, so those pieces remain discoverable. Homepage layout is resolved on the server, so the embedded preview shows the new structure after **Make it live**, not while arranging; the thumbnails and ordered list in the editor itself stand in for it meanwhile. Wording, pictures and per-field previews on the homepage behave like any other page.

### Product and collection content

Use **Products** for saved names, descriptions, highlights, base prices and media on published, file-mirrored products. The first colour variant with photos, ordered by display order, supplies the shelf thumbnail. Its selected **Primary** photo takes precedence over automatic image-quality ranking. Primary selection is per variant, not a product-wide flag spanning every colour.

Use **Collections** for existing collections' saved names, descriptions, cover images and ordered membership. Use **Storefront Signals** for customer-facing availability. Catalog sync creates missing records while preserving existing product copy/media and collection edits.

The file catalog still defines the public product routes and collection set. Creating an unrelated database product or changing a mirrored slug does not automatically create a new public catalog entry. Missing or unreadable saved rows fall back to file data; therefore database archive/inactive flags alone are not a reliable way to remove file-authored entries. Manage public availability/visibility with the storefront controls.

Authored videos remain available, with saved uploaded videos added to the gallery. Removing an authored video still requires changing the file catalog. A page-specific image override takes precedence over the underlying product image on that page; restore that override if a later Primary change appears masked.

## Rendering and cache behavior

`PageContentProvider` receives cached published content from the public layout. `ContentRegion` applies text, image and visibility overrides during rendering, including server rendering. The editor exchanges preview data only with its same-origin iframe. `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'` permit that preview while blocking embedding by other origins.

| Cache tag | Content | Invalidated by |
| --- | --- | --- |
| `storefront-pages` | Page text/images/visibility and homepage layout | Publishing or restoring a version in the page editor. Saving a draft deliberately does not invalidate it. |
| `storefront-media` | Mirrored product copy, primary photos and uploaded videos | Product save/status changes and catalog sync |
| `storefront-collections` | Existing collection copy and membership | Collection/catalog actions and sync |
| `storefront-availability` | Public availability signals | Storefront Signals save |

These reads have a 60-second revalidation fallback. Save actions invalidate the relevant tags and public paths. New Cloudinary upload URLs retain their versions, giving different selected images different Next.js image-cache keys. Already-open browser tabs may need a reload.

Content identifiers combine the page/region name with element paths and React keys. Preserve those keys and structures when refactoring edited regions, or migrate the corresponding stored identifiers. Saved visible text does not automatically update route metadata or structured data.

## Mobile and video changes

Product grids use two columns on phones. The product gallery is height-bounded, its thumbnail strip stays within the page, and the product name, price and WhatsApp action appear above the gallery on mobile. Public body text is at least 16px, controls have at least 44px touch targets, and navigation/WhatsApp labels remain visible without hover.

Video URLs are converted to still-image posters wherever an image thumbnail is required. Local clips use their prepared `.poster.jpg` files; Cloudinary clips use a JPG frame URL while retaining URL versions and query parameters. The product viewer exposes video controls, reloads when changing clips, and CSP explicitly permits Cloudinary media.

## Verification for this revision

- TypeScript and lint passed (lint keeps only the pre-existing `ImportUploader.tsx` effect-cleanup warning).
- 188 unit tests passed, including new coverage that a saved draft never invalidates the public cache, that publishing snapshots the previous version, that restoring an earlier version republishes it, that a missing version and an invented page path are refused, and that failed writes report failure without invalidating.
- Production build passed.
- Live admin saves against migrations 017/018 have **not** been exercised against a real database; the actions are covered with mocked Postgrest clients only. Run the smoke check under "Enable publishing" after applying the migrations.
- The Playwright editor spec covers the preview protocol, which is unchanged; the rebuilt admin interface itself has no browser test yet.

Re-run relevant checks with:

```sh
npm run types
npm run lint
npm test
npm run build
npx playwright test e2e/page-editor.spec.ts e2e/public-site.spec.ts --workers=2 --timeout=90000
```

The Playwright configuration starts a server when needed; its full admin suite requires the local Supabase stack. Production builds need access to Google Fonts unless those assets are already cached.
