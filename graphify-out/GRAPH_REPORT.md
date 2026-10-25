# Graph Report - WCS  (2026-10-25)

## Corpus Check
- 548 files · ~394,231 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 6, .toml 2, .woff2 2)

## Summary
- 3638 nodes · 8795 edges · 180 communities (159 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 129 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `300a7b2e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- mocks.ts
- page-content-actions.ts
- ContentRegion
- Admin Server Actions
- Validation & Contacts
- supabase/types.ts
- next
- Product Admin Actions
- storefront-overrides.ts
- Admin Inquiries & Dashboard
- StorefrontAvailabilityTable.tsx
- products.ts
- Lighthouse CI
- Project Health Audit
- Admin Session & CSP
- Rate Limiting
- WhatsApp Webhook
- Admin Image Uploader
- Live RLS Tests
- print-report.mjs
- prepare-logo.mjs
- cn
- Visual Regression CI
- Database CI
- Implementation Task Plan
- not-found.tsx
- Migration Runner
- Enrichment Actions
- Admin Sign-in & Import API
- E2E CI
- analytics.ts
- Guides & Collections Pages
- ProductCard.tsx
- WhatsApp Media Curation
- whatsapp_inbox
- Package Dependencies
- WhatsApp Text Naming
- WhatsApp Draft Review
- AI Provider Interface
- WhatsApp Product Pipeline
- Reconcile
- Whatsapp health
- ContactForm.tsx
- Restore drill
- Budget
- Codeql
- Storefront availability actions
- cloudinary.ts
- Storefront catalog resilience
- Media
- Package
- Verify p0
- whatsapp-curation.test.ts
- Listing analysis
- products
- sync-actions.ts
- CLAUDE
- VariantManager
- Whatsapp sweep
- AuthForm.tsx
- Rules
- createClient
- Dependabot
- 028_whatsapp_inbox_drain_dead_letter.sql
- public.inquiries
- Migration PHASE BY PHASE TASKS
- Helpers
- ThemeToggle
- Storefront catalog
- whatsapp_ingest_events
- Tsconfig
- Catalog visibility snapshot
- Reprocess
- Whatsapp route tests
- contact/page.tsx
- requireAdmin
- security-advisor-findings.test.ts
- Catalog visibility mirror
- Whatsapp review
- Whatsapp route tests
- P0 FIXES
- Storefront catalogue
- page-content.ts
- Admin guide
- Deployment
- Migration AUDIT REPORT
- Migration MASTER IMPLEMENTATION PLAN
- Ci
- Package
- 009_import_pipeline.sql
- vitest
- CategoryForm.tsx
- Route
- storefront-catalog-resilience.test.ts
- Lighthouse ci
- Import pipeline
- README
- Ci
- Build fixtures
- Page
- ImportUploader
- CLAUDE
- Migration PHASE BY PHASE TASKS
- Migration SECURITY PLAN
- Backup scope
- Ci
- consent.ts
- indexnow.ts
- Queries
- Rows
- Optimize video
- EnquiryForm.tsx
- Database.types
- Migration FREE TIER COST ANALYSIS
- Migration safety
- Release process
- SEO SETUP
- Grouping
- Website pages
- Ai cost controls
- Check env
- Structured data
- Import asset complete tests
- Import upload sign tests
- Package
- Ci
- Compare
- reportError
- pages/page.tsx
- Migration PHASE BY PHASE TASKS
- Backup restore
- Privacy
- check-migrations.mjs
- Logger
- Import product regression guard tests
- Storefront catalogue
- Security advisor 033
- Backup restore
- Ci
- Image loader
- Ci
- (public)/page.tsx
- public.change_storefront_availability
- Ci
- Ci
- Package
- ImportWorkspace.tsx
- .eslintrc
- Package
- Postcss.config
- Build output.txt
- Vercel
- Badge
- page-editor-parts.tsx
- 011_customer_carts.sql
- PasswordResetForm
- PageContentEditor
- 005_contacts_crm.sql
- 038_admin_list_indexes.sql
- indexnow.mjs
- ImageGallery.tsx
- 035_ai_usage.sql
- catalog-hidden-slugs.ts
- 036_admin_audit_log.sql
- 018_page_content_drafts.sql
- 017_storefront_page_content.sql

## God Nodes (most connected - your core abstractions)
1. `next` - 138 edges
2. `vitest` - 111 edges
3. `ContentRegion()` - 91 edges
4. `react` - 90 edges
5. `assertAdmin()` - 86 edges
6. `toResult()` - 76 edges
7. `03 Phase-by-Phase Tasks` - 61 edges
8. `Button` - 57 edges
9. `requireAdmin()` - 54 edges
10. `cn()` - 52 edges

## Surprising Connections (you probably didn't know these)
- `RETIRED_SLUGS retirement procedure` --conceptually_related_to--> `RETIRED_SLUGS`  [INFERRED]
  docs/storefront-catalogue.md → CLAUDE.md
- `storefront_hidden_slugs (migration 021)` --conceptually_related_to--> `storefront_hidden_slugs view (migration 021)`  [INFERRED]
  docs/storefront-catalogue.md → CLAUDE.md
- `Admin <-> storefront bridge (getStorefrontCatalog)` --conceptually_related_to--> `Storefront Catalog Reconciliation (file list vs Postgres)`  [INFERRED]
  docs/storefront-catalogue.md → CLAUDE.md
- `Dual Source of Truth Risk` --conceptually_related_to--> `Two Data Sources (file storefront + Supabase admin)`  [INFERRED]
  docs/PROJECT_AUDIT.md → CLAUDE.md
- `Deployment Guide` --references--> `Catalog Visibility Fails Closed`  [INFERRED]
  docs/deployment.md → CLAUDE.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Backup and restore chain** — docs_implementation_plan_03_phase_by_phase_tasks_t1_1, docs_implementation_plan_03_phase_by_phase_tasks_t1_2, docs_implementation_plan_03_phase_by_phase_tasks_t1_3, docs_implementation_plan_03_phase_by_phase_tasks_t1_4, docs_implementation_plan_03_phase_by_phase_tasks_t1_11, docs_implementation_plan_04_database_migration_plan_backup_reader_role [EXTRACTED 1.00]
- **Catalog visibility fail-closed fallback chain** — claude_visibility_fail_closed, claude_catalog_visibility_mirror, claude_catalog_visibility_snapshot, claude_catalog_unavailable, docs_storefront_catalogue_visibility_max_stale_ms, docs_storefront_catalogue_visibility_fail_open [EXTRACTED 1.00]
- **WhatsApp ingestion durability failures** — docs_project_health_check_f02, docs_project_health_check_f03, docs_project_health_check_f04, docs_project_health_check_f05, docs_project_health_check_whatsapp_ingestion_report [EXTRACTED 1.00]
- **Free-tier and spend hard caps** — docs_runbooks_quota_monitoring_free_tier_hard_caps, docs_runbooks_ai_cost_controls_anthropic_spend_limit, docs_runbooks_backup_scope_artifact_retention, docs_runbooks_ai_cost_controls_daily_feature_caps [INFERRED 0.75]
- **Admin authentication layers** — claude_admin_defense_in_depth, docs_deployment_admin_totp_mfa, docs_deployment_admin_signin_throttling, docs_deployment_admin_session_length, docs_p0_fixes_f24_safe_redirect [INFERRED 0.85]
- **AI cost-control stack** — docs_implementation_plan_03_phase_by_phase_tasks_t2_1, docs_implementation_plan_03_phase_by_phase_tasks_t2_2, docs_implementation_plan_03_phase_by_phase_tasks_t2_3, docs_implementation_plan_03_phase_by_phase_tasks_t2_9, docs_implementation_plan_04_database_migration_plan_ai_usage_daily, docs_implementation_plan_01_audit_report_p3_ai [INFERRED 0.85]
- **Backup chain: scope, encryption, custody, restore drill** — docs_runbooks_backup_scope_auth_path_b, docs_runbooks_backup_scope_age_encryption, docs_runbooks_secrets_and_keys_three_copy_custody, docs_runbooks_backup_restore_restore_drill, docs_runbooks_backup_restore_l0_recovery [INFERRED 0.85]
- **Migration ledger consistency across apply and restore** — docs_runbooks_migration_safety_apply_routes, docs_runbooks_backup_restore_ledger_gap, docs_runbooks_security_advisor_033_apply_order_030_033 [INFERRED 0.85]
- **WhatsApp ingestion grouping and reliability** — claude_whatsapp_ingestion, docs_deployment_whatsapp_grouping_rules, docs_deployment_whatsapp_settings, docs_deployment_whatsapp_sweep, docs_p0_fixes_whatsapp_durable_inbox, docs_p0_fixes_dependency_ordering_028, ingest_eval_readme_replay_harness [INFERRED 0.85]

## Communities (180 total, 21 thin omitted)

### Community 0 - "mocks.ts"
Cohesion: 0.05
Nodes (49): all, run(), all, run(), DEFAULT, run(), SHUFFLES, streams (+41 more)

### Community 1 - "page-content-actions.ts"
Cohesion: 0.16
Nodes (18): AdminClient, parseFor(), publishPageContent(), restorePageVersion(), revalidatePublic(), savePageDraft(), scopeFor(), snapshot() (+10 more)

### Community 2 - "ContentRegion"
Cohesion: 0.09
Nodes (32): AccountPage(), metadata, PublicLayout(), metadata, PrivacyPage(), metadata, ShippingReturnsPage(), metadata (+24 more)

### Community 3 - "Admin Server Actions"
Cohesion: 0.06
Nodes (75): deleteCategory(), deleteContact(), exportContactsCsv(), reorderCollectionProducts(), toResult(), ImportBatchPage(), applyPendingMigrations(), addCollectionAlias() (+67 more)

### Community 4 - "Validation & Contacts"
Cohesion: 0.04
Nodes (77): getContactByNormalizedPhone(), importContactsCsv(), listContacts(), listContactsInternal(), normalizePhone(), parseCsvLine(), saveContact(), dynamic (+69 more)

### Community 5 - "supabase/types.ts"
Cohesion: 0.07
Nodes (35): dynamic, EditProductPage(), dynamic, NewProductPage(), CollectionCheckboxes(), Props, HiddenMediaItem, HiddenMediaTray() (+27 more)

### Community 6 - "next"
Cohesion: 0.12
Nodes (24): next, react, EVENTS, buildQueryString(), ContactTable(), fmtDate(), Props, Factor (+16 more)

### Community 7 - "Product Admin Actions"
Cohesion: 0.07
Nodes (44): deleteProduct(), duplicateProduct(), ensurePublishAllowed(), getCategorySlugById(), getCollectionSlugById(), getProductRefsById(), loadExistingProductRefs(), makeStableCode() (+36 more)

### Community 8 - "storefront-overrides.ts"
Cohesion: 0.09
Nodes (41): AVAIL_LABELS, CategoryPage(), generateMetadata(), generateStaticParams(), PageProps, revalidate, AVAIL_LABELS, CatalogPage() (+33 more)

### Community 9 - "Admin Inquiries & Dashboard"
Cohesion: 0.06
Nodes (49): ActionResult, setAiKillSwitch(), AdminInquiriesPage(), dynamic, first(), AdminDashboard(), count(), dueFollowUps() (+41 more)

### Community 10 - "StorefrontAvailabilityTable.tsx"
Cohesion: 0.18
Nodes (15): AdminSubscribersPage(), dynamic, first(), Pagination(), Props, buildQueryString(), fmtDate(), SubscriberTable() (+7 more)

### Community 11 - "products.ts"
Cohesion: 0.05
Nodes (60): PAGES, VIEWPORTS, generateMetadata(), generateStaticParams(), ProductPage(), revalidate, Row(), handleAdd() (+52 more)

### Community 12 - "Lighthouse CI"
Cohesion: 0.04
Nodes (45): concurrency, cancel-in-progress, group, env, ADMIN_EMAILS, CATALOG_SNAPSHOT_OPTIONAL, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (+37 more)

### Community 13 - "Project Health Audit"
Cohesion: 0.06
Nodes (43): T5.2 Structured data without invented facts, Project Health Check (audit 2026-10-04), Cache tags storefront-media/availability/collections/pages, Database/RLS report (23 migrations on disposable PG18), F02 Batched Meta messages silently discarded, F03 Webhook acknowledges failed non-atomic ingestion, F04 Session finalization races lose media, F05 Inbound media lacks size/type/hash limits (+35 more)

### Community 14 - "Admin Session & CSP"
Cohesion: 0.09
Nodes (30): dynamic, POST(), runtime, seen, decideMfa(), evaluateSession(), hmac(), LAST_SEEN_COOKIE (+22 more)

### Community 15 - "Rate Limiting"
Cohesion: 0.08
Nodes (27): POST(), runtime, BucketName, BUCKETS, checkLoginRateLimit(), checkRateLimit(), clientIp(), decide() (+19 more)

### Community 16 - "WhatsApp Webhook"
Cohesion: 0.09
Nodes (29): extractMessages(), GET(), maxDuration, messageMediaId(), messageMediaKind(), normalizeCaption(), parseMessageTimestamp(), runtime (+21 more)

### Community 17 - "Admin Image Uploader"
Cohesion: 0.14
Nodes (13): DragPayload, ImageUploader(), handleContainerDrop(), handleThumbnailDrop(), Props, readDragPayload(), isVideoMedia(), pickPreviewHero() (+5 more)

### Community 18 - "Live RLS Tests"
Cohesion: 0.08
Nodes (20): ids, STOREFRONT_TABLES, ids, admin(), ARRAY_PARAMS, bootstrap(), config, createDbAt() (+12 more)

### Community 19 - "print-report.mjs"
Cohesion: 0.20
Nodes (6): args, only, report, results, rules, summaryOnly

### Community 20 - "prepare-logo.mjs"
Cohesion: 0.07
Nodes (35): BANNED_COLOUR_TOKENS, callAnthropic(), findColourRangeBySlug(), imageBlock(), loadEnvLocal(), main(), MEDIA, OUT (+27 more)

### Community 21 - "cn"
Cohesion: 0.16
Nodes (22): lucide-react, motion, CartPage(), metadata, AddToCartButton(), CartDrawer(), CartUndoToast(), CartView() (+14 more)

### Community 22 - "Visual Regression CI"
Cohesion: 0.05
Nodes (38): CATALOG_SNAPSHOT_OPTIONAL, NEXT_TELEMETRY_DISABLED, SENTRY_AUTH_TOKEN, VISIBILITY_FAIL_OPEN, VISUAL, update, jobs, visual (+30 more)

### Community 23 - "Database CI"
Cohesion: 0.05
Nodes (37): concurrency, cancel-in-progress, group, name, runs-on, services, steps, timeout-minutes (+29 more)

### Community 24 - "Implementation Task Plan"
Cohesion: 0.07
Nodes (37): P3-AI AI cost controls (uncapped spend path), 03 Phase-by-Phase Tasks, Task cost classification, Reusable procedures D1/D2/R1/R2/R3/F1, T1.10 Migration safety and expand/contract policy, T1.13 Build-time hidden-slug snapshot, T1.5 Fix product-visibility fail-open (Project A-1), T1.6 Catalogue fallback logging and throttling (+29 more)

### Community 26 - "Migration Runner"
Cohesion: 0.10
Nodes (26): client, __dirname, migrationsDir, DatabasePage(), dynamic, ApplyResult, connectionString(), getPendingMigrations() (+18 more)

### Community 27 - "Enrichment Actions"
Cohesion: 0.07
Nodes (50): AdminClient, applyColorSplit(), applyProductEnrichment(), ColorSplitCandidate, Embed, EnrichmentCandidate, firstOf(), IdentifierRow (+42 more)

### Community 28 - "Admin Sign-in & Import API"
Cohesion: 0.16
Nodes (23): POST(), runtime, POST(), runtime, POST(), runtime, isEmailAllowed(), getVerifiedUser (+15 more)

### Community 29 - "E2E CI"
Cohesion: 0.06
Nodes (34): concurrency, cancel-in-progress, group, LOCAL_SERVICE_ROLE_KEY, NEXT_TELEMETRY_DISABLED, SENTRY_AUTH_TOKEN, jobs, playwright (+26 more)

### Community 30 - "analytics.ts"
Cohesion: 0.11
Nodes (23): @sentry/nextjs, onRouterTransitionStart, onRequestError, register(), ALLOWED_EVENT_PARAMS, allowedParams(), fired, GtagEventParams (+15 more)

### Community 31 - "Guides & Collections Pages"
Cohesion: 0.06
Nodes (42): inter, playfair, RootLayout(), AboutPage(), logoUrl, metadata, schema, CollectionsIndexPage() (+34 more)

### Community 32 - "ProductCard.tsx"
Cohesion: 0.22
Nodes (11): ProductPreview(), Props, Props, ProductCard(), ProductGrid(), formatPrice(), getDisplayPrice(), PriceRange (+3 more)

### Community 33 - "WhatsApp Media Curation"
Cohesion: 0.08
Nodes (45): ShotType, StoredAnalysis, textKey(), generateProductSKU(), AUTHENTICITY, count(), DescriptionContext, JOINING (+37 more)

### Community 34 - "whatsapp_inbox"
Cohesion: 0.08
Nodes (35): public.whatsapp_take(), public.claim_next_whatsapp_message(), public.claim_whatsapp_replies(), public.enqueue_whatsapp_messages(), public.whatsapp_assign(), public.whatsapp_burst_rows(), public.whatsapp_freeze(), public.whatsapp_listing_audit (+27 more)

### Community 35 - "Package Dependencies"
Cohesion: 0.09
Nodes (31): devDependencies, autoprefixer@^10.5.2, @axe-core/playwright@4.10.2, eslint@^8, eslint-config-next@15.5.28, postcss@^8.5.28, tailwindcss-animate@^1.0.7, @types/node@^20 (+23 more)

### Community 36 - "WhatsApp Text Naming"
Cohesion: 0.12
Nodes (25): article(), CHATTER, Clause, clauses(), COLOURS, DEFAULT_HYPE_TERMS, describeFromAdminText(), DESCRIPTORS (+17 more)

### Community 37 - "WhatsApp Draft Review"
Cohesion: 0.16
Nodes (18): markProductReviewed(), MarkReviewedButton(), mark(), Props, WhatsAppDraftPanel(), AuditRow, CLOSED, CONFIDENCE (+10 more)

### Community 38 - "AI Provider Interface"
Cohesion: 0.07
Nodes (28): AiProvider, CollectionCandidate, ClassificationMethod, ClassificationResult, ClassificationState, classifyDeterministically(), ClassifyGroupInput, ExistingCollection (+20 more)

### Community 39 - "WhatsApp Product Pipeline"
Cohesion: 0.13
Nodes (33): POST(), isRenderableCloudinaryUrl(), messageRef(), buildProductPlan(), ClaimedMessage, CloudinaryUploadResponse, deliverReplies(), downloadMediaFromMeta() (+25 more)

### Community 40 - "Reconcile"
Cohesion: 0.14
Nodes (23): CartContext, CartContextValue, CartProvider(), onStorage(), readStorage(), RemovedItem, writeStorage(), coerceItems() (+15 more)

### Community 41 - "Whatsapp health"
Cohesion: 0.13
Nodes (20): dynamic, GET(), noStore(), runtime, dynamic, GET(), maxDuration, runtime (+12 more)

### Community 42 - "ContactForm.tsx"
Cohesion: 0.16
Nodes (15): dynamic, EditContactPage(), dynamic, NewContactPage(), ContactForm(), ContactFormInitial, Props, roleOptions (+7 more)

### Community 43 - "Restore drill"
Cohesion: 0.08
Nodes (17): args, ARTIFACT, checks, createdRoles, DB, failed, KEEP, KEY (+9 more)

### Community 44 - "Budget"
Cohesion: 0.12
Nodes (23): acquire(), AiDenial, AiFeature, ANTHROPIC_API_URL, AnthropicRequest, dailyCap(), DEFAULT_DAILY_CAPS, GatedResult (+15 more)

### Community 45 - "Codeql"
Cohesion: 0.07
Nodes (26): name, permissions, runs-on, steps, timeout-minutes, concurrency, cancel-in-progress, group (+18 more)

### Community 46 - "Storefront availability actions"
Cohesion: 0.15
Nodes (22): bulkStorefrontAvailability(), Change, clearStorefrontAvailability(), getSignalHistory(), refresh(), setStorefrontAvailability(), SignalHistoryEntry, undoSignalChanges() (+14 more)

### Community 47 - "cloudinary.ts"
Cohesion: 0.22
Nodes (10): MediaThumb(), Props, CategoryCard(), CollectionCard(), cld(), cldVideoThumbnail(), Transform, TRANSFORMS (+2 more)

### Community 48 - "Storefront catalog resilience"
Cohesion: 0.13
Nodes (20): assertVisibilityConfirmed(), CatalogSource, describe(), failures, getCatalogResilienceStatus(), lastGood, lastReportedAt, lastSuccess (+12 more)

### Community 49 - "Media"
Cohesion: 0.08
Nodes (24): BASE_REF, MEDIA_FAIL_ON_OVERSIZED, jobs, media, name, runs-on, steps, timeout-minutes (+16 more)

### Community 50 - "Package"
Cohesion: 0.09
Nodes (23): dependencies, class-variance-authority@^0.7.0, clsx@^2.1.1, lucide-react@^0.454.0, motion@^12.43.0, next@15.5.28, pg@^8.22.0, qrcode@^1.5.4 (+15 more)

### Community 51 - "Verify p0"
Cohesion: 0.12
Nodes (16): asset(), checkpoint(), claim(), claimNext(), clock, complete(), config, db (+8 more)

### Community 52 - "whatsapp-curation.test.ts"
Cohesion: 0.09
Nodes (25): sharp@^0.35.4, sharp, AnalysisItem, AnalysisRequest, pickAiImages(), requestAnalysis(), withTimeout(), IngestConfig (+17 more)

### Community 53 - "Listing analysis"
Cohesion: 0.07
Nodes (30): anthropicAiProvider, callAnthropic(), classificationResponseSchema, colorVariantResponseSchema, getListingModel(), getModel(), ImageBlock, metadataResponseSchema (+22 more)

### Community 54 - "products"
Cohesion: 0.11
Nodes (25): categories, collection_products, idx_collection_products_collection_id, idx_product_variants_product_id, idx_products_category_id, idx_products_featured, idx_products_status, idx_variant_images_one_primary (+17 more)

### Community 55 - "sync-actions.ts"
Cohesion: 0.06
Nodes (47): AdminProductsPage(), dynamic, first(), applyProductIdentifiers(), IdentifierCandidate, listIdentifierCandidates(), loadIdentifierRefs(), reserve() (+39 more)

### Community 56 - "CLAUDE"
Cohesion: 0.12
Nodes (19): CLAUDE.md Project Guide, Zod Validation at API Boundary, Content Guide, Photo guidelines (portrait, 1000x1500), ?ref= source tagging for shared links, Admin sign-in throttling (fail-closed), Diagrams README, runtime-architecture.html (+11 more)

### Community 57 - "VariantManager"
Cohesion: 0.24
Nodes (15): defaultSingleVariant(), emptyVariant(), makeClientKey(), VariantManager(), add(), addSingle(), handleExternalDrop(), move() (+7 more)

### Community 58 - "Whatsapp sweep"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, CRON_SECRET, SITE_URL, jobs, sweep, name (+13 more)

### Community 59 - "AuthForm.tsx"
Cohesion: 0.12
Nodes (17): AdminLoginPage(), LoginForm(), handleSubmit(), AdminMfaPage(), dynamic, GET(), metadata, SignInPage() (+9 more)

### Community 60 - "Rules"
Cohesion: 0.17
Nodes (17): SnapProduct, check(), descriptionViolations(), evaluate(), fail(), FILLER, Finding, MAX_IMAGES (+9 more)

### Community 61 - "createClient"
Cohesion: 0.15
Nodes (20): recordMfaEvent(), MfaChallenge(), signOut(), submit(), MfaManager(), cancel(), confirm(), remove() (+12 more)

### Community 62 - "Dependabot"
Cohesion: 0.10
Nodes (19): patterns, github-actions, npm-development, npm-production, dependency-name, update-types, dependency-type, update-types (+11 more)

### Community 63 - "028_whatsapp_inbox_drain_dead_letter.sql"
Cohesion: 0.10
Nodes (16): public.claim_whatsapp_message(), public.complete_whatsapp_message(), public.enqueue_whatsapp_messages(), public.whatsapp_batches, public.whatsapp_inbox, whatsapp_inbox_work, whatsapp_one_open_batch, public.claim_next_whatsapp_message() (+8 more)

### Community 64 - "public.inquiries"
Cohesion: 0.12
Nodes (15): public.storefront_hidden_slugs, public.product_source_texts, public.product_media_labels, public.restore_hidden_media(), public.variant_hidden_media, public.whatsapp_after_product(), variant_hidden_media_product, public.storefront_hidden_slugs (+7 more)

### Community 65 - "Migration PHASE BY PHASE TASKS"
Cohesion: 0.12
Nodes (19): Project B: database as single product source, T1.1 Backup scope discovery and backup_reader role, T4.3 Inquiry workflow schema, T4.4 Inquiry admin UI, T4.7 Server-side admin list pagination, T4.9 Inquiry idempotency key, T7.2 Constraints and slug_redirects registry, T7.3 Idempotent file-product import (+11 more)

### Community 66 - "Helpers"
Cohesion: 0.18
Nodes (10): ADMIN_EMAIL, ADMIN_PASSWORD, loginAsAdmin(), mockCloudinaryUpload(), mockImportCloudinaryUpload(), readMultipartField(), startFakeUpstash(), @playwright/test@^1.62.1 (+2 more)

### Community 67 - "ThemeToggle"
Cohesion: 0.19
Nodes (13): AdminLayout(), NAV, AdminMobileNav(), AdminSidebar(), ICONS, SignOutButton(), handleSignOut(), applyTheme() (+5 more)

### Community 68 - "Storefront catalog"
Cohesion: 0.16
Nodes (23): RETIRED_SLUGS, applyPriceOverrides(), COLOUR_WORDS, detectColourFamily(), getHiddenSlugs, getPublishedRows, isVideoRow(), mergeStorefrontCatalog() (+15 more)

### Community 69 - "whatsapp_ingest_events"
Cohesion: 0.14
Nodes (14): admin_upload_sessions, idx_admin_upload_sessions_product_id, idx_admin_upload_sessions_variant_id, trg_admin_upload_sessions_updated_at, idx_whatsapp_ingest_events_message_timestamp, idx_whatsapp_ingest_events_product_id, idx_whatsapp_ingest_events_sender_phone, idx_whatsapp_ingest_events_variant_id (+6 more)

### Community 70 - "Tsconfig"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 71 - "Catalog visibility snapshot"
Cohesion: 0.13
Nodes (12): catalogVisibilitySnapshot, nextConfig, env, fetchHiddenSlugs(), parseVisibilitySnapshot(), readSnapshotFile(), SNAPSHOT_FILE, SNAPSHOT_VERSION (+4 more)

### Community 72 - "Reprocess"
Cohesion: 0.14
Nodes (25): BANNED_NAME_WORDS, CATALOGUE_STYLE_PREAMBLE, COLOUR_STYLE_GUIDE, composeProductName(), enforceNameStyle(), extractKeyDetail(), HIGHLIGHTS_STYLE_GUIDE, isDescriptiveWord() (+17 more)

### Community 73 - "Whatsapp route tests"
Cohesion: 0.20
Nodes (14): bySent(), database(), blocked(), bury(), claimNext(), closeEmpty(), enqueue(), finishUnassigned() (+6 more)

### Community 74 - "contact/page.tsx"
Cohesion: 0.14
Nodes (15): metadata, EnquirySentPage(), metadata, ENQUIRY_STORAGE_KEY, EnquirySent(), Snapshot, Wrapper(), EMAIL (+7 more)

### Community 75 - "requireAdmin"
Cohesion: 0.09
Nodes (23): AdminCategoriesPage(), dynamic, dynamic, EditCollectionPage(), dynamic, NewCollectionPage(), AdminCollectionsPage(), dynamic (+15 more)

### Community 76 - "security-advisor-findings.test.ts"
Cohesion: 0.29
Nodes (4): ALL, executeGrants(), flat(), MIGRATIONS

### Community 77 - "Catalog visibility mirror"
Cohesion: 0.21
Nodes (14): backingOff(), failureCounts, getVisibilityMirrorStatus(), lastReportedAt, MirroredVisibility, note(), parse(), readVisibilityMirror() (+6 more)

### Community 78 - "Whatsapp review"
Cohesion: 0.14
Nodes (27): deriveProductName(), GENERIC_NAME, NEW_PRODUCT_CAPTION_HINT, parseCollectionMessage(), parseProductCaption(), Candidate, describePriceFlag(), labelOf() (+19 more)

### Community 79 - "Whatsapp route tests"
Cohesion: 0.15
Nodes (10): album(), deliveries, envelope(), message(), mocks, request(), send(), sweep() (+2 more)

### Community 80 - "P0 FIXES"
Cohesion: 0.13
Nodes (14): Pull Request Template, Database Migration Checklist (additive, isolated test, backup <24h), Verification Checklist (lint/types/test/build/e2e), DATABASE_URL session-mode connection, review_status pending_review publish gate, P0 Audit Fixes (2026-10-04), F01 Disable one-click migration apply + advisory-locked CLI runner, F11 Publish requires approved/not_required review (+6 more)

### Community 81 - "Storefront catalogue"
Cohesion: 0.18
Nodes (13): Token-Based Theming (hsl(var(--token))), Admin <-> storefront bridge (getStorefrontCatalog), Brand assets (prepare-logo.mjs, BrandMark), Colour-variant swatches (siblings + derived shades), Storefront Catalogue Doc, Enquiry -> WhatsApp handoff, Media pipeline scripts (prepare/optimize/score), ProductSeed / SEEDS (src/data/products.ts) (+5 more)

### Community 82 - "page-content.ts"
Cohesion: 0.17
Nodes (14): FILTERS, REGION_ORDER, contentImageSchema, EDITABLE_PAGES, editablePageSchema, fieldHint(), PageContentMap, PageOverrides (+6 more)

### Community 83 - "Admin guide"
Cohesion: 0.16
Nodes (13): Adding a Saree via WhatsApp, Applying database updates (Database page), Admin Guide (Non-Technical), Hidden Images tray (restore), Mark a colour as sold out, Normalise codes & web addresses, Stock signal (Storefront Signals), Unassigned WhatsApp media draft (+5 more)

### Community 84 - "Deployment"
Cohesion: 0.15
Nodes (14): Admin session length limits, AI Budget (budget.ts, ai_usage_daily, migration 035), Analytics consent banner, Canonical URL safety net (ignores *.vercel.app), CSP report-only sampling, Deployment Guide, Health endpoint /api/health, INGEST_* tunables (+6 more)

### Community 85 - "Migration AUDIT REPORT"
Cohesion: 0.14
Nodes (14): 01 Audit Report, P0.1 Consolidate product data sources (Partial), P0.3 Media storage and repository growth, P0.4 Free-tier quota monitoring, P0.5 Rate limiting and bot protection, P1.2 Security headers, P1.3 WhatsApp webhook idempotency (Implemented), P1.4 Dependency and secret security (+6 more)

### Community 86 - "Migration MASTER IMPLEMENTATION PLAN"
Cohesion: 0.13
Nodes (11): 02 Master Implementation Plan, Task dependency graph, Eight phases (74 tasks), Scheduled-job reliability table, Incremental target architecture, T1.3 Restore drill and recovery levels L0/L1, 08 Implementation Checklist, Owner decisions to record (+3 more)

### Community 87 - "Ci"
Cohesion: 0.13
Nodes (15): env, ADMIN_EMAILS, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, NEXT_PUBLIC_BUSINESS_NAME, NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (+7 more)

### Community 88 - "Package"
Cohesion: 0.13
Nodes (15): scripts, audit:lighthouse, build, check:env, dev, eval:ingest, indexnow, lint (+7 more)

### Community 89 - "009_import_pipeline.sql"
Cohesion: 0.20
Nodes (19): collections, collection_aliases, idx_collection_aliases_collection_id, idx_import_assets_batch_id, idx_import_assets_group_id, idx_import_assets_one_primary, idx_import_product_groups_batch_id, idx_import_product_groups_product_id (+11 more)

### Community 90 - "vitest"
Cohesion: 0.10
Nodes (19): DIR, FIRST, loadStreams(), vitest, force, photos(), WIDTHS, LIMITS (+11 more)

### Community 91 - "CategoryForm.tsx"
Cohesion: 0.24
Nodes (9): dynamic, EditCategoryPage(), dynamic, NewCategoryPage(), CategoryForm(), CategoryFormInitial, Props, Textarea (+1 more)

### Community 92 - "Route"
Cohesion: 0.19
Nodes (12): escapeHtml(), InquiryData, POST(), runtime, saveInquiry(), sendNotification(), mockCheckRateLimit, mockInsert (+4 more)

### Community 93 - "storefront-catalog-resilience.test.ts"
Cohesion: 0.13
Nodes (13): dynamic, StorefrontAvailabilityPage(), StorefrontAvailabilityTable(), getStorefrontCatalog(), READ_TIMEOUT_MS, RETRY_AFTER_MS, SNAPSHOT_STALE_AFTER_MS, hiddenRows() (+5 more)

### Community 94 - "Lighthouse ci"
Cohesion: 0.22
Nodes (7): lighthouse@^13.4.1, lighthouse, BUDGETS, evaluate(), firstProductPath(), main(), summary()

### Community 95 - "Import pipeline"
Cohesion: 0.19
Nodes (10): Re-run AI naming & tagging, Split photos into colour variants, Product name format, AI provider interface (null + anthropic), Colour-variant detection (color-variants.ts), Product Media Import Pipeline Doc, Grouping heuristics (grouping.ts), Import data model (migrations 009/010) (+2 more)

### Community 96 - "README"
Cohesion: 0.15
Nodes (11): WhatsApp Webhook HMAC Signature Verification, GitHub Actions CI workflows, scripts/verify-p0.mjs local SQL regression, Type/schema drift (hand-maintained types.ts), WhatsApp Ingestion Replay Harness README, Event stream fixtures (F1..TXT15), Oracle AI provider, WhatsApp ingestion replay harness (+3 more)

### Community 97 - "Ci"
Cohesion: 0.26
Nodes (13): name, runs-on, steps, timeout-minutes, steps, audit, steps, if (+5 more)

### Community 98 - "Build fixtures"
Cohesion: 0.19
Nodes (9): builder(), f4(), F4_NAME, many(), MESSY, out, rng(), sha() (+1 more)

### Community 99 - "Page"
Cohesion: 0.23
Nodes (10): AiUsagePage(), dynamic, FEATURE_LABELS, number, totals(), AiKillSwitch(), AiSettingsRow, AiUsageData (+2 more)

### Community 100 - "ImportUploader"
Cohesion: 0.23
Nodes (11): ImportUploader(), cancel(), enqueueFiles(), patchItem(), retry(), uploadOne(), kindOf(), newId() (+3 more)

### Community 101 - "CLAUDE"
Cohesion: 0.20
Nodes (8): <CatalogUnavailable> degraded surface, Catalog Visibility Mirror (Upstash Redis), Prebuild Catalog Visibility Snapshot, RETIRED_SLUGS, storefront_hidden_slugs view (migration 021), syncFileProducts one-way mirror, Sync storefront products button, syncFileProducts mirror (file_sync source, migration 013)

### Community 102 - "Migration PHASE BY PHASE TASKS"
Cohesion: 0.18
Nodes (11): P0.2 Database backups and recovery (Missing), P2.1 CI/CD deployment protection, T1.11 Backup freshness watchdog, T1.12 Main-branch protection and deployment gating, T1.2 Scheduled encrypted backup workflow (private repo), T1.4 Key custody and secret rotation runbook, T6.5 CI pipeline structure, 05 CI/CD Plan (+3 more)

### Community 103 - "Migration SECURITY PLAN"
Cohesion: 0.18
Nodes (11): T1.7 Rate-limit failure policy, T3.4 Server-side login throttling, T3.6 CSP report-only rollout, T3.7 CSP nonce tightening (conditional), T3.8 Cloudflare Turnstile (only if abused), 06 Security Plan and Threat Model, Assets and trust boundaries, Prioritised security backlog (+3 more)

### Community 104 - "Backup scope"
Cohesion: 0.24
Nodes (7): L0 database-only recovery, Backup scope decision record, Backup include/exclude matrix, RPO 24h / RTO 4h (L0) / 1 day (L1), Secrets, keys and credential-loss recovery (T1.4), Security calendar reminders, Credential loss procedures

### Community 105 - "Ci"
Cohesion: 0.17
Nodes (11): name, runs-on, timeout-minutes, concurrency, cancel-in-progress, group, jobs, build (+3 more)

### Community 106 - "consent.ts"
Cohesion: 0.32
Nodes (13): ConsentBanner(), CookieSettingsLink(), ConsentGate(), Analytics(), analyticsAllowed(), Consent, CONSENT_EVENT, CONSENT_KEY (+5 more)

### Community 107 - "indexnow.ts"
Cohesion: 0.30
Nodes (9): dynamic, GET(), indexNowKey(), lastSent, pingIndexNow(), resetIndexNow(), siteBase(), submitToIndexNow() (+1 more)

### Community 108 - "Queries"
Cohesion: 0.35
Nodes (11): CatalogFilters, getActiveCollections(), getAllPublishedSlugs(), getCategories(), getCategoryBySlug(), getCollectionBySlug(), getFeaturedProducts(), getProductBySlug() (+3 more)

### Community 109 - "Rows"
Cohesion: 0.20
Nodes (8): a, ai, args, b, clip(), fmt(), [from, to], only

### Community 110 - "Optimize video"
Cohesion: 0.25
Nodes (9): ffmpeg-static@^5.2.0, ffprobe-static@^3.1.0, ffmpeg-static, ffprobe-static, main(), MEDIA, probe(), run (+1 more)

### Community 111 - "EnquiryForm.tsx"
Cohesion: 0.09
Nodes (36): EnquiryPage(), metadata, countDigits(), EnquiryForm(), handleSubmit(), Errors, Field(), SHOPPING_FOR (+28 more)

### Community 112 - "Database.types"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 113 - "Migration FREE TIER COST ANALYSIS"
Cohesion: 0.20
Nodes (6): T5.6 Media inventory and size budget, T5.7 AVIF feasibility spike, 07 Free-Tier Cost Analysis, Service free-tier comparison matrix, Backup storage formula S x (D+W) within 500 MB, Unexpected-charge risks and prevention

### Community 114 - "Migration safety"
Cohesion: 0.24
Nodes (6): backup_reader role, Migration ledger gap, Migration safety runbook (T1.10), Production apply routes (run-migrations.mjs, db query --linked, SQL Editor + repair), Migration change checklist, backup_reader rotation and revocation

### Community 115 - "Release process"
Cohesion: 0.22
Nodes (8): Dependencies runbook (T6.9), Dependabot grouped weekly upgrades, npm audit --omit=dev CI gate, Release process runbook, Branch protection break-glass, Option A: PR-and-merge without bypass, Required check 'Lint, types, unit tests, build', Vercel Deployment Checks (unverified on Hobby)

### Community 116 - "SEO SETUP"
Cohesion: 0.20
Nodes (6): SEO Setup Guide, Google Search Console verification, Guides (src/data/guides.ts), IndexNow manual submission, Pinterest Save Button, WhatsApp click GA4 event (WhatsAppLink)

### Community 117 - "Grouping"
Cohesion: 0.33
Nodes (7): chunk(), filenameIdentifier(), GroupableAsset, ProposedGroup, proposeGroups(), topFolder(), ImportGroupingMethod

### Community 118 - "Website pages"
Cohesion: 0.28
Nodes (9): storefront-media cache tag (60s), F14 Page Draft Isolation (migration 024), Storefront cache tags (pages/media/collections/availability), ContentRegion / PageContentProvider, Website Page Editing Guide, Homepage layout panel, Page drafts + version history (migration 018), Website Pages editor (/admin/pages) (+1 more)

### Community 119 - "Ai cost controls"
Cohesion: 0.31
Nodes (6): AI cost controls runbook, /admin/ai-usage page, AI_KILL_SWITCH, Anthropic Console spend limit (hard cap), Quota monitoring runbook (T2.7, T2.8), Monthly owner usage check

### Community 120 - "Check env"
Cohesion: 0.22
Nodes (7): ingestNames, invalid, missing, optional, required, unsetOptional, values

### Community 121 - "Structured data"
Cohesion: 0.42
Nodes (7): AVAILABILITY, businessFacts(), dayRange(), Env, productJsonLd(), shippingDetails(), ld()

### Community 122 - "Import asset complete tests"
Cohesion: 0.22
Nodes (6): mockBatchMaybeSingle, mockCheckImportRateLimit, mockDuplicateLookup, mockGetUser, mockUpdate, mockUpsertSingle

### Community 123 - "Import upload sign tests"
Cohesion: 0.22
Nodes (6): mockBatchMaybeSingle, mockCheckImportRateLimit, mockCount, mockGetUser, mockSignUpload, mockUpsert

### Community 124 - "Package"
Cohesion: 0.25
Nodes (6): @supabase/ssr@^0.6.1, @supabase/supabase-js@^2.45.4, @supabase/ssr, @supabase/supabase-js, db, endpoint

### Community 125 - "Ci"
Cohesion: 0.25
Nodes (8): with, cache, if-no-files-found, name, node-version-file, path, persist-credentials, retention-days

### Community 126 - "Compare"
Cohesion: 0.29
Nodes (5): before, broken, fixed, [from, to], key()

### Community 127 - "reportError"
Cohesion: 0.21
Nodes (12): adminSignIn(), AdminSignInResult, signInSchema, AuditEntry, cleanAuditMeta(), cleanValue(), recordAudit(), reportError() (+4 more)

### Community 128 - "pages/page.tsx"
Cohesion: 0.18
Nodes (12): zod@^4.6.7, zod, dynamic, PagesDashboard(), getFeaturedProducts(), DEFAULT_HOMEPAGE, HOME_SECTIONS, HomepageContent (+4 more)

### Community 129 - "Migration PHASE BY PHASE TASKS"
Cohesion: 0.33
Nodes (7): P1.1 Admin authentication hardening, T3.1 Admin audit log table, T3.2 Wire audit logging into admin actions, T3.3 TOTP MFA for admin, T3.5 Session lifetime policy, admin_audit_log table, Admin audit-log design (append-only by grants, migration 036)

### Community 130 - "Backup restore"
Cohesion: 0.29
Nodes (5): Restore drill (scripts/restore-drill.mjs), wcs-backup-ops repo, Weekly quota-check.yml, Quarterly test-decrypt of each copy, Not in 033: default-grant revokes, leaked password protection, edge functions

### Community 131 - "Privacy"
Cohesion: 0.29
Nodes (6): Personal data inventory (T3.12), Personal data flows to third parties, Deleting one person's data, Open owner retention decisions, Personal data stores table, Yearly age key rotation

### Community 132 - "check-migrations.mjs"
Cohesion: 0.21
Nodes (6): addedMigrations(), ALLOWED_HOSTS, BOOTSTRAP_SQL, lintMigration(), main(), BASE_ENV

### Community 133 - "Logger"
Cohesion: 0.39
Nodes (7): log(), LogFields, logger, LogLevel, redact(), redactString(), requestIdFrom()

### Community 134 - "Import product regression guard tests"
Cohesion: 0.29
Nodes (5): CONFIRMED_CLASSIFICATION, GROUP, IMAGE_ASSET, makeFakeAdmin(), mockAssertAdmin

### Community 135 - "Storefront catalogue"
Cohesion: 0.33
Nodes (3): Customer Accounts (optional, cart/profile only), Admin TOTP two-factor rollout + break-glass, Customer accounts + server carts (migrations 011/012)

### Community 136 - "Security advisor 033"
Cohesion: 0.33
Nodes (5): Applying 033_security_advisor_findings.sql, follow_product_availability execute revoke, storefront_hidden_slugs view hardening, (select auth.uid()) in carts/profiles policies, Fixed search_path on trigger/helper functions

### Community 137 - "Backup restore"
Cohesion: 0.40
Nodes (4): Backup restore runbook (T1.3), Backup alerts and freshness (T1.11), L1 full application recovery, Secret inventory (names and locations only)

### Community 138 - "Ci"
Cohesion: 0.33
Nodes (6): verify, if, name, needs, runs-on, timeout-minutes

### Community 139 - "Image loader"
Cohesion: 0.60
Nodes (4): cloudinaryUrl(), imageLoader(), LOCAL_VARIANT_WIDTHS, localVariant()

### Community 140 - "Ci"
Cohesion: 0.40
Nodes (5): branches, branches, True, pull_request, push

### Community 141 - "(public)/page.tsx"
Cohesion: 0.24
Nodes (12): ContactPage(), HomePage(), metadata, revalidate, STEPS, HomeHero(), HomepageSections(), PortraitVideo() (+4 more)

### Community 142 - "public.change_storefront_availability"
Cohesion: 0.21
Nodes (6): storefront_availability_overrides, product_availability_lifecycle, public.change_storefront_availability(), public.follow_product_availability(), public.product_stock_signal(), public.storefront_availability_history

### Community 143 - "Ci"
Cohesion: 0.50
Nodes (4): static, name, runs-on, timeout-minutes

### Community 144 - "Ci"
Cohesion: 0.50
Nodes (4): unit, name, runs-on, timeout-minutes

### Community 145 - "Package"
Cohesion: 0.50
Nodes (3): tailwindcss@^3.4.14, tailwindcss, config

### Community 146 - "ImportWorkspace.tsx"
Cohesion: 0.36
Nodes (10): dynamic, Props, GroupBundle, Props, ImportAsset, ImportCollectionClassification, ImportGroupWithRelations, ImportProductGroup (+2 more)

### Community 148 - "Package"
Cohesion: 0.67
Nodes (3): overrides, postcss, postcss-selector-parser

### Community 152 - "Badge"
Cohesion: 0.26
Nodes (9): AdminImportPage(), dynamic, STATUS_BADGE, MAP, StatusBadge(), Badge(), BadgeProps, badgeVariants (+1 more)

### Community 153 - "page-editor-parts.tsx"
Cohesion: 0.33
Nodes (7): ContentFieldCard(), formatWhen(), HistoryPanel(), ImagePicker(), trim(), VisibilitySwitch(), ContentField

### Community 154 - "011_customer_carts.sql"
Cohesion: 0.33
Nodes (6): carts_touch_updated_at, public.carts, public.carts_touch_updated_at(), profiles_touch_updated_at, public.profiles, public.profiles_touch_updated_at()

### Community 155 - "PasswordResetForm"
Cohesion: 0.32
Nodes (5): ForgotPasswordPage(), metadata, metadata, ResetPasswordPage(), PasswordResetForm()

### Community 156 - "PageContentEditor"
Cohesion: 0.29
Nodes (4): PageContentEditor(), preview(), receive(), restore()

### Community 157 - "005_contacts_crm.sql"
Cohesion: 0.46
Nodes (7): contacts, idx_contacts_next_follow_up_on, idx_contacts_phone, idx_contacts_phone_normalized, idx_contacts_role, idx_contacts_status_tag, trg_contacts_updated_at

### Community 158 - "038_admin_list_indexes.sql"
Cohesion: 0.38
Nodes (4): contacts_source_idx, contacts_updated_at_idx, whatsapp_subscribers_opted_in_at_idx, whatsapp_subscribers_source_idx

### Community 159 - "indexnow.mjs"
Cohesion: 0.29
Nodes (4): body, env, explicitUrls, siteUrl

### Community 160 - "ImageGallery.tsx"
Cohesion: 0.43
Nodes (5): ImageGallery(), Props, PinterestSaveButton(), PinterestSaveButtonProps, VariantImage

### Community 161 - "035_ai_usage.sql"
Cohesion: 0.33
Nodes (3): public.ai_settings, public.ai_try_reserve(), public.ai_usage_daily

### Community 162 - "catalog-hidden-slugs.ts"
Cohesion: 0.70
Nodes (3): fetchHiddenSlugs(), refreshVisibilityMirror(), mocks

### Community 163 - "036_admin_audit_log.sql"
Cohesion: 0.60
Nodes (3): admin_audit_log_at_idx, admin_audit_log_entity_idx, public.admin_audit_log

## Ambiguous Edges - Review These
- `F01 Disable one-click migration apply + advisory-locked CLI runner` → `Applying database updates (Database page)`  [AMBIGUOUS]
  docs/admin-guide.md · relation: conceptually_related_to

## Knowledge Gaps
- **123 isolated node(s):** `next/core-web-vitals`, `<CatalogUnavailable> degraded surface`, `Catalog Visibility Mirror (Upstash Redis)`, `Prebuild Catalog Visibility Snapshot`, `Workflow permissions matrix (public app repo vs private ops repo)` (+118 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1321 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `vitest` to `mocks.ts`, `Admin Server Actions`, `check-migrations.mjs`, `Validation & Contacts`, `Import product regression guard tests`, `Product Admin Actions`, `storefront-overrides.ts`, `Admin Inquiries & Dashboard`, `StorefrontAvailabilityTable.tsx`, `products.ts`, `Image loader`, `Logger`, `Admin Session & CSP`, `Rate Limiting`, `WhatsApp Webhook`, `Admin Image Uploader`, `Live RLS Tests`, `Migration Runner`, `Enrichment Actions`, `Admin Sign-in & Import API`, `analytics.ts`, `WhatsApp Media Curation`, `catalog-hidden-slugs.ts`, `Package Dependencies`, `WhatsApp Draft Review`, `AI Provider Interface`, `Reconcile`, `Whatsapp health`, `Budget`, `Storefront availability actions`, `cloudinary.ts`, `Storefront catalog resilience`, `whatsapp-curation.test.ts`, `Listing analysis`, `sync-actions.ts`, `AuthForm.tsx`, `Rules`, `Storefront catalog`, `Catalog visibility snapshot`, `Reprocess`, `security-advisor-findings.test.ts`, `Catalog visibility mirror`, `Whatsapp review`, `Whatsapp route tests`, `page-content.ts`, `Route`, `storefront-catalog-resilience.test.ts`, `Lighthouse ci`, `consent.ts`, `indexnow.ts`, `EnquiryForm.tsx`, `Grouping`, `Structured data`, `Import asset complete tests`, `Import upload sign tests`, `reportError`?**
  _High betweenness centrality (0.172) - this node is a cross-community bridge._
- **What connects `next/core-web-vitals`, `<CatalogUnavailable> degraded surface`, `Catalog Visibility Mirror (Upstash Redis)` to the rest of the system?**
  _123 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `mocks.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0546583850931677 - nodes in this community are weakly interconnected._
- **Why does `next` connect `next` to `pages/page.tsx`, `page-content-actions.ts`, `ContentRegion`, `Admin Server Actions`, `Validation & Contacts`, `supabase/types.ts`, `storefront-overrides.ts`, `Admin Inquiries & Dashboard`, `StorefrontAvailabilityTable.tsx`, `products.ts`, `(public)/page.tsx`, `Admin Session & CSP`, `Rate Limiting`, `WhatsApp Webhook`, `ImportWorkspace.tsx`, `cn`, `Badge`, `not-found.tsx`, `page-editor-parts.tsx`, `Enrichment Actions`, `Admin Sign-in & Import API`, `PasswordResetForm`, `Migration Runner`, `Guides & Collections Pages`, `ProductCard.tsx`, `Package Dependencies`, `WhatsApp Draft Review`, `Whatsapp health`, `ContactForm.tsx`, `Storefront availability actions`, `cloudinary.ts`, `Package`, `sync-actions.ts`, `AuthForm.tsx`, `createClient`, `ThemeToggle`, `Storefront catalog`, `contact/page.tsx`, `requireAdmin`, `page-content.ts`, `vitest`, `CategoryForm.tsx`, `Route`, `consent.ts`, `indexnow.ts`, `EnquiryForm.tsx`, `reportError`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Should `ContentRegion` be split into smaller, more focused modules?**
  _Cohesion score 0.08653061224489796 - nodes in this community are weakly interconnected._
- **Why does `react` connect `next` to `pages/page.tsx`, `page-content-actions.ts`, `ContentRegion`, `Admin Server Actions`, `supabase/types.ts`, `storefront-overrides.ts`, `Admin Inquiries & Dashboard`, `StorefrontAvailabilityTable.tsx`, `products.ts`, `(public)/page.tsx`, `Admin Image Uploader`, `ImportWorkspace.tsx`, `cn`, `Badge`, `page-editor-parts.tsx`, `Enrichment Actions`, `Admin Sign-in & Import API`, `Guides & Collections Pages`, `ProductCard.tsx`, `ImageGallery.tsx`, `Package Dependencies`, `WhatsApp Draft Review`, `Reconcile`, `ContactForm.tsx`, `Storefront availability actions`, `cloudinary.ts`, `Package`, `sync-actions.ts`, `AuthForm.tsx`, `createClient`, `ThemeToggle`, `contact/page.tsx`, `page-content.ts`, `CategoryForm.tsx`, `Page`, `ImportUploader`, `consent.ts`, `EnquiryForm.tsx`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `F01 Disable one-click migration apply + advisory-locked CLI runner` and `Applying database updates (Database page)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._