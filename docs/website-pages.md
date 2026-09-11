# Website page editing and mobile storefront

## Enable publishing

1. Apply any outstanding database migrations in order. On a project already at migration 016, run [017_storefront_page_content.sql](../supabase/migrations/017_storefront_page_content.sql) once in the Supabase SQL Editor.
2. Deploy this revision with the existing Supabase and Cloudinary environment variables.
3. Sign in at `/admin` and open **Website pages** (`/admin/pages`).
4. Make a small text change, check the preview, and select **Save and publish**. Verify the public page in a separate tab. Use **Restore original** and save to undo the change.

Migration 017 creates a published-content table with public read access and no public write policy. Writes use the server-only service-role client after `assertAdmin` verifies the session and email allowlist. No new environment variables are required. If the table is unavailable, the editor disables publishing and public pages retain their authored defaults.

The migration has been prepared but was **not applied to the remote database** during implementation. Live publishing still needs the setup and smoke check above. Supabase API credentials alone cannot apply SQL migrations.

## Everyday editing

### Public text, images and sections

- Choose a page, then choose **Text**, **Images**, or **Sections**. Use the search field to find specific copy.
- Edit text, image descriptions, or an image URL; alternatively upload a replacement image. The embedded preview shows unsaved changes.
- Header, footer and branding fields marked **sitewide** apply across pages. Other edits apply to the selected route.
- Use section visibility controls to show or hide existing sections. Homepage sections have dedicated controls described below.
- **Save and publish** publishes the changed scopes. **Discard unsaved edits** returns to the last saved values. **Restore original** removes a field override after saving.
- Conditional content, such as an open cart drawer, becomes editable when it appears in the preview.

The editor changes visible content within the existing design. Routes, SEO metadata, application behavior, and custom HTML/CSS/scripts remain code-managed. Text is escaped, not interpreted as HTML. Image URLs must use local `/media/` or `/brand/` assets, or the configured Cloudinary account.

### Homepage layout

Expand **Homepage layout and product placement** to choose the welcome saree, up to four featured sarees, section visibility/order, and shelf order. The welcome saree cannot also occupy a featured position. Hiding welcome or featured sections returns their products to the shelf, so those pieces remain discoverable. Publish the layout, then reload the general preview to see its new structure.

### Product and collection content

Use **Products** for saved names, descriptions, highlights, base prices and media on published, file-mirrored products. The first colour variant with photos, ordered by display order, supplies the shelf thumbnail. Its selected **Primary** photo takes precedence over automatic image-quality ranking. Primary selection is per variant, not a product-wide flag spanning every colour.

Use **Collections** for existing collections' saved names, descriptions, cover images and ordered membership. Use **Storefront Signals** for customer-facing availability. Catalog sync creates missing records while preserving existing product copy/media and collection edits.

The file catalog still defines the public product routes and collection set. Creating an unrelated database product or changing a mirrored slug does not automatically create a new public catalog entry. Missing or unreadable saved rows fall back to file data; therefore database archive/inactive flags alone are not a reliable way to remove file-authored entries. Manage public availability/visibility with the storefront controls.

Authored videos remain available, with saved uploaded videos added to the gallery. Removing an authored video still requires changing the file catalog. A page-specific image override takes precedence over the underlying product image on that page; restore that override if a later Primary change appears masked.

## Rendering and cache behavior

`PageContentProvider` receives cached published content from the public layout. `ContentRegion` applies text, image and visibility overrides during rendering, including server rendering. The editor exchanges preview data only with its same-origin iframe. `X-Frame-Options: SAMEORIGIN` and CSP `frame-ancestors 'self'` permit that preview while blocking embedding by other origins.

| Cache tag | Content | Invalidated by |
| --- | --- | --- |
| `storefront-pages` | Page text/images/visibility and homepage layout | Page editor save |
| `storefront-media` | Mirrored product copy, primary photos and uploaded videos | Product save/status changes and catalog sync |
| `storefront-collections` | Existing collection copy and membership | Collection/catalog actions and sync |
| `storefront-availability` | Public availability signals | Storefront Signals save |

These reads have a 60-second revalidation fallback. Save actions invalidate the relevant tags and public paths. New Cloudinary upload URLs retain their versions, giving different selected images different Next.js image-cache keys. Already-open browser tabs may need a reload.

Content identifiers combine the page/region name with element paths and React keys. Preserve those keys and structures when refactoring edited regions, or migrate the corresponding stored identifiers. Saved visible text does not automatically update route metadata or structured data.

## Mobile and video changes

Product grids use two columns on phones. The product gallery is height-bounded, its thumbnail strip stays within the page, and the product name, price and WhatsApp action appear above the gallery on mobile. Public body text is at least 16px, controls have at least 44px touch targets, and navigation/WhatsApp labels remain visible without hover.

Video URLs are converted to still-image posters wherever an image thumbnail is required. Local clips use their prepared `.poster.jpg` files; Cloudinary clips use a JPG frame URL while retaining URL versions and query parameters. The product viewer exposes video controls, reloads when changing clips, and CSP explicitly permits Cloudinary media.

## Verification for this revision

- Production build and TypeScript checks passed.
- Lint passed with the existing `ImportUploader.tsx` effect-cleanup warning.
- 184 unit tests passed, including primary-image persistence/invalidation, video poster handling, page validation, admin authorization, escaped server rendering, and failed-save behavior.
- 12 browser tests passed against the production build. Coverage includes editor preview text/image/section changes, video thumbnails/playback selection, public navigation, and shelf completeness/no overflow at 320, 390, 768 and 1280px. All 13 default remaining shelf products were present.
- Save actions were tested with mocked database writes. An authenticated live admin save against migration 017 has not been verified.

Re-run relevant checks with:

```sh
npm run types
npm run lint
npm test
npm run build
npx playwright test e2e/page-editor.spec.ts e2e/public-site.spec.ts --workers=2 --timeout=90000
```

The Playwright configuration starts a server when needed; its full admin suite requires the local Supabase stack. Production builds need access to Google Fonts unless those assets are already cached.
