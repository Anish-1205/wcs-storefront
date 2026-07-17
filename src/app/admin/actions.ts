"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { slugify } from "@/lib/utils";
import type {
  Collection,
  CollectionProduct,
  Contact,
  ProductStatus,
  StockType,
  VariantStatus,
  ProductWithRelations,
  Product,
  ProductVariant,
  VariantImage,
} from "@/lib/supabase/types";
import {
  collectionInputSchema,
  contactImportRowSchema,
  contactSchema,
  contactsQuerySchema,
  parseContactDateTimeValue,
  parseContactDateValue,
  productInputSchema,
  type CollectionInputShape,
  type ContactImportRowShape,
  type ContactInputShape,
  type ContactsQueryShape,
  type ProductInputShape,
} from "@/lib/validation";

function revalidatePublic(slug: string) {
  revalidatePath("/");
  revalidatePath("/catalog");
  revalidatePath("/catalog/[category]", "page");
  revalidatePath("/collections/[slug]", "page");
  revalidatePath(`/sarees/${slug}`);
}

function revalidateCatalogShell() {
  revalidatePath("/");
  revalidatePath("/catalog");
  revalidatePath("/collections");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/collections");
}

function makeUniqueSlug(base: string, existing: Set<string>) {
  const root = slugify(base);
  let candidate = root;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${root}-${counter++}`;
  }
  return candidate;
}

async function loadExistingProductRefs(admin: Awaited<ReturnType<typeof assertAdmin>>["admin"]) {
  const [{ data: products }, { data: collections }] = await Promise.all([
    admin.from("products").select("slug, product_code"),
    admin.from("collections").select("slug"),
  ]);
  return {
    productSlugs: new Set((products ?? []).map((p) => (p as { slug: string }).slug)),
    productCodes: new Set(
      (products ?? [])
        .map((p) => (p as { product_code: string | null }).product_code)
        .filter((value): value is string => !!value),
    ),
    collectionSlugs: new Set((collections ?? []).map((c) => (c as { slug: string }).slug)),
  };
}

function withoutValue(values: Set<string>, removed?: string | null) {
  return Array.from(values).filter((value) => value !== removed);
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizePhone(value: string) {
  return value.replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
}

async function getContactByNormalizedPhone(admin: Awaited<ReturnType<typeof assertAdmin>>["admin"], phone: string) {
  const normalized = normalizePhone(phone).toLowerCase();
  const { data } = await admin
    .from("contacts")
    .select("*")
    .or(`phone.eq.${phone},phone.eq.${normalized}`)
    .maybeSingle();
  return data as Contact | null;
}

async function listContactsInternal(admin: Awaited<ReturnType<typeof assertAdmin>>["admin"], query: ContactsQueryShape) {
  let q = admin.from("contacts").select("*");
  if (query.q) {
    const escaped = query.q.replace(/%/g, "\\%").replace(/_/g, "\\_");
    q = q.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,notes.ilike.%${escaped}%`);
  }
  if (query.role) q = q.eq("role", query.role);
  if (query.status_tag) q = q.eq("status_tag", query.status_tag);
  if (query.source) q = q.eq("source", query.source);
  q = q.order(query.sort, { ascending: query.dir === "asc" });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Contact[];
}

export async function listContacts(query: Partial<ContactsQueryShape> = {}) {
  const { admin } = await assertAdmin();
  const parsed = contactsQuerySchema.safeParse(query);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid contacts query");
  return listContactsInternal(admin, parsed.data);
}

export async function saveContact(input: ContactInputShape): Promise<{ id: string }> {
  const { admin } = await assertAdmin();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid contact");
  input = parsed.data;

  const row = {
    name: input.name,
    phone: input.phone,
    role: input.role,
    status_tag: input.status_tag,
    city: input.city,
    source: input.source,
    whatsapp_opt_in: input.whatsapp_opt_in,
    rating: input.rating,
    notes: input.notes,
    last_contacted_at: parseContactDateTimeValue(input.last_contacted_at),
    next_follow_up_on: parseContactDateValue(input.next_follow_up_on),
  };

  let id = input.id;
  if (id) {
    const { error } = await admin.from("contacts").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const existing = await getContactByNormalizedPhone(admin, input.phone);
    if (existing) {
      const { error } = await admin.from("contacts").update(row).eq("id", existing.id);
      if (error) throw new Error(error.message);
      id = existing.id;
    } else {
      const { data, error } = await admin.from("contacts").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      id = data.id as string;
    }
  }

  revalidatePath("/admin/contacts");
  return { id };
}

export async function deleteContact(id: string) {
  const { admin } = await assertAdmin();
  const { error } = await admin.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/contacts");
}

export async function exportContactsCsv(query: Partial<ContactsQueryShape> = {}) {
  const { admin } = await assertAdmin();
  const parsed = contactsQuerySchema.safeParse(query);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid contacts query");
  const rows = await listContactsInternal(admin, parsed.data);
  const header = [
    "name",
    "phone",
    "role",
    "status_tag",
    "city",
    "source",
    "whatsapp_opt_in",
    "rating",
    "notes",
    "last_contacted_at",
    "next_follow_up_on",
  ];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.name,
      row.phone,
      row.role,
      row.status_tag,
      row.city ?? "",
      row.source,
      row.whatsapp_opt_in,
      row.rating ?? "",
      row.notes ?? "",
      row.last_contacted_at ?? "",
      row.next_follow_up_on ?? "",
    ].map(csvEscape).join(",")),
  ].join("\n");
}

export async function importContactsCsv(csvText: string) {
  const { admin } = await assertAdmin();
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { total: 0, inserted: 0, updated: 0, skipped: 0, errors: [] as Array<{ row: number; message: string }> };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const rows = lines.slice(1);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 2;
    const values = parseCsvLine(rows[index]);
    const raw = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    const parsed = contactImportRowSchema.safeParse({
      ...raw,
      whatsapp_opt_in: raw.whatsapp_opt_in === "true" || raw.whatsapp_opt_in === "1",
      rating: raw.rating === "" ? null : raw.rating,
      last_contacted_at: raw.last_contacted_at || null,
      next_follow_up_on: raw.next_follow_up_on || null,
    });
    if (!parsed.success) {
      skipped += 1;
      errors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }

    const row = parsed.data;
    const existing = await getContactByNormalizedPhone(admin, row.phone);
    const payload = {
      name: row.name,
      phone: row.phone,
      role: row.role,
      status_tag: row.status_tag,
      city: row.city ?? null,
      source: row.source,
      whatsapp_opt_in: row.whatsapp_opt_in,
      rating: row.rating ?? null,
      notes: row.notes ?? null,
      last_contacted_at: parseContactDateTimeValue(row.last_contacted_at),
      next_follow_up_on: parseContactDateValue(row.next_follow_up_on),
    };

    if (existing) {
      const { error } = await admin.from("contacts").update(payload).eq("id", existing.id);
      if (error) {
        skipped += 1;
        errors.push({ row: rowNumber, message: error.message });
        continue;
      }
      updated += 1;
    } else {
      const { error } = await admin.from("contacts").insert(payload);
      if (error) {
        skipped += 1;
        errors.push({ row: rowNumber, message: error.message });
        continue;
      }
      inserted += 1;
    }
  }

  revalidatePath("/admin/contacts");
  return { total: rows.length, inserted, updated, skipped, errors };
}

async function getCollectionSlugById(admin: Awaited<ReturnType<typeof assertAdmin>>["admin"], id: string) {
  const { data } = await admin.from("collections").select("slug").eq("id", id).maybeSingle();
  return (data as { slug?: string } | null)?.slug ?? null;
}

/**
 * Create or update a product with its variants, images, and collection
 * assignments. Variants/images are replaced wholesale (delete + recreate) for
 * simplicity and correctness in the MVP.
 */
export async function saveProduct(input: ProductInputShape): Promise<{ id: string }> {
  const { admin } = await assertAdmin();
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid product");
  input = parsed.data;

  let previousSlug: string | null = null;
  if (input.id) {
    const { data } = await admin.from("products").select("slug").eq("id", input.id).maybeSingle();
    previousSlug = (data as { slug?: string } | null)?.slug ?? null;
  }

  const refs = await loadExistingProductRefs(admin);
  const slug = input.slug?.trim()
    ? makeUniqueSlug(input.slug, new Set(withoutValue(refs.productSlugs, input.id)))
    : makeUniqueSlug(input.name, new Set(withoutValue(refs.productSlugs, input.id)));
  const productCode = input.product_code?.trim()
    ? makeUniqueSlug(input.product_code, new Set(withoutValue(refs.productCodes, input.product_code)))
    : null;

  const productRow = {
    name: input.name,
    slug,
    category_id: input.category_id,
    fabric_type: input.fabric_type,
    description: input.description,
    highlights: input.highlights,
    base_price_min: input.base_price_min,
    base_price_max: input.base_price_max,
    status: input.status,
    product_code: productCode,
    is_featured: input.is_featured,
    stock_type: input.stock_type,
  };

  let productId = input.id;

  if (productId) {
    const { error } = await admin
      .from("products")
      .update(productRow)
      .eq("id", productId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin
      .from("products")
      .insert(productRow)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    productId = data.id as string;
  }

  // Get existing variants for this product
  let existingVariants: { id: string }[] = [];
  if (input.id) {
    const { data, error } = await admin
      .from("product_variants")
      .select("id")
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
    existingVariants = data || [];
  }

  // Identify deletes, updates, inserts
  const incomingIds = new Set(input.variants.map((v) => v.id).filter(Boolean));
  const toDelete = existingVariants.filter((ev) => !incomingIds.has(ev.id));
  const toUpdate = input.variants.filter((v) => v.id && existingVariants.some((ev) => ev.id === v.id));
  const toInsert = input.variants.filter((v) => !v.id || !existingVariants.some((ev) => ev.id === v.id));

  // 1. Delete removed variants
  if (toDelete.length > 0) {
    const deleteIds = toDelete.map((ev) => ev.id);
    const { error: delErr } = await admin
      .from("product_variants")
      .delete()
      .in("id", deleteIds);
    if (delErr) throw new Error(delErr.message);
  }

  // 2. Update existing variants
  for (const v of toUpdate) {
    const { error: updErr } = await admin
      .from("product_variants")
      .update({
        color: v.color,
        color_hex: v.color_hex,
        status: v.status,
        price_min: v.price_min,
        price_max: v.price_max,
        display_order: v.display_order,
      })
      .eq("id", v.id!);
    if (updErr) throw new Error(updErr.message);

    // Replace variant images: delete existing and insert new
    const { error: imgDelErr } = await admin
      .from("variant_images")
      .delete()
      .eq("variant_id", v.id!);
    if (imgDelErr) throw new Error(imgDelErr.message);

    if (v.images.length > 0) {
      let primarySeen = false;
      const rows = v.images.map((img, i) => {
        const isPrimary = img.is_primary && !primarySeen;
        if (isPrimary) primarySeen = true;
        return {
          variant_id: v.id!,
          image_url: img.image_url,
          is_primary: i === 0 && !v.images.some((x) => x.is_primary) ? true : isPrimary,
          display_order: img.display_order,
        };
      });
      if (!rows.some((r) => r.is_primary) && rows[0]) rows[0].is_primary = true;

      const { error: imgErr } = await admin.from("variant_images").insert(rows);
      if (imgErr) throw new Error(imgErr.message);
    }
  }

  // 3. Insert new variants
  for (const v of toInsert) {
    const insertRow: any = {
      product_id: productId,
      color: v.color,
      color_hex: v.color_hex,
      status: v.status,
      price_min: v.price_min,
      price_max: v.price_max,
      display_order: v.display_order,
    };
    if (v.id) {
      insertRow.id = v.id;
    }

    const { data: variantRow, error: insErr } = await admin
      .from("product_variants")
      .insert(insertRow)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    if (v.images.length > 0) {
      let primarySeen = false;
      const rows = v.images.map((img, i) => {
        const isPrimary = img.is_primary && !primarySeen;
        if (isPrimary) primarySeen = true;
        return {
          variant_id: variantRow.id,
          image_url: img.image_url,
          is_primary: i === 0 && !v.images.some((x) => x.is_primary) ? true : isPrimary,
          display_order: img.display_order,
        };
      });
      if (!rows.some((r) => r.is_primary) && rows[0]) rows[0].is_primary = true;

      const { error: imgErr } = await admin.from("variant_images").insert(rows);
      if (imgErr) throw new Error(imgErr.message);
    }
  }

  // Replace collection assignments.
  await admin.from("collection_products").delete().eq("product_id", productId);
  if (input.collection_ids.length > 0) {
    const { error: cErr } = await admin.from("collection_products").insert(
      input.collection_ids.map((collection_id, i) => ({
        collection_id,
        product_id: productId!,
        display_order: i,
      })),
    );
    if (cErr) throw new Error(cErr.message);
  }

  if (previousSlug && previousSlug !== slug) {
    revalidatePath(`/sarees/${previousSlug}`);
  }
  revalidatePublic(slug);
  revalidateCatalogShell();
  return { id: productId };
}

export async function duplicateProduct(id: string): Promise<{ id: string }> {
  const { admin } = await assertAdmin();
  const { data: product, error } = await admin
    .from("products")
    .select("*, product_variants(*, variant_images(*)), collection_products(collection_id, display_order)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) throw new Error("Product not found");

  const refs = await loadExistingProductRefs(admin);
  const source = product as ProductWithRelations & { collection_products?: CollectionProduct[] };
  const duplicateSlug = makeUniqueSlug(`${source.slug}-copy`, refs.productSlugs);
  const duplicateCodeSource = source.product_code?.trim() || source.slug || source.name;
  const duplicateCode = makeUniqueSlug(`${duplicateCodeSource}-copy`, refs.productCodes);

  const { data: inserted, error: insertError } = await admin
    .from("products")
    .insert({
      name: `${source.name} Copy`,
      slug: duplicateSlug,
      category_id: source.category_id,
      fabric_type: source.fabric_type,
      description: source.description,
      highlights: source.highlights,
      base_price_min: source.base_price_min,
      base_price_max: source.base_price_max,
      status: "draft",
      product_code: duplicateCode,
      is_featured: false,
      stock_type: source.stock_type,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const newId = inserted.id as string;

  for (const variant of source.product_variants ?? []) {
    const { data: newVariant, error: variantError } = await admin
      .from("product_variants")
      .insert({
        product_id: newId,
        color: variant.color,
        color_hex: variant.color_hex,
        status: variant.status,
        price_min: variant.price_min,
        price_max: variant.price_max,
        display_order: variant.display_order,
      })
      .select("id")
      .single();
    if (variantError) throw new Error(variantError.message);

    if (variant.variant_images?.length) {
      const imageRows = variant.variant_images.map((image) => ({
        variant_id: newVariant.id,
        image_url: image.image_url,
        is_primary: image.is_primary,
        display_order: image.display_order,
      }));
      const { error: imageError } = await admin.from("variant_images").insert(imageRows);
      if (imageError) throw new Error(imageError.message);
    }
  }

  const collectionRows = (source as { collection_products?: CollectionProduct[] }).collection_products ?? [];
  if (collectionRows.length > 0) {
    const { error: collectionsError } = await admin.from("collection_products").insert(
      collectionRows.map((row) => ({
        collection_id: row.collection_id,
        product_id: newId,
        display_order: row.display_order,
      })),
    );
    if (collectionsError) throw new Error(collectionsError.message);
  }

  revalidatePublic(slugify(source.slug));
  revalidateCatalogShell();
  return { id: newId };
}

export async function updateProductStatus(id: string, status: ProductStatus) {
  const { admin } = await assertAdmin();
  const { data, error } = await admin
    .from("products")
    .update({ status })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) throw new Error(error.message);
  revalidatePublic(data.slug as string);
  revalidatePath("/admin/products");
}

export async function toggleFeatured(id: string, is_featured: boolean) {
  const { admin } = await assertAdmin();
  const { data, error } = await admin
    .from("products")
    .update({ is_featured })
    .eq("id", id)
    .select("slug")
    .single();
  if (error) throw new Error(error.message);
  revalidatePublic(data.slug as string);
  revalidateCatalogShell();
}

export async function deleteProduct(id: string) {
  const { admin } = await assertAdmin();
  const { data } = await admin
    .from("products")
    .select("slug")
    .eq("id", id)
    .single();
  const { error } = await admin.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (data?.slug) revalidatePublic(data.slug as string);
  revalidateCatalogShell();
}

export async function saveCollection(input: CollectionInputShape): Promise<{ id: string }> {
  const { admin } = await assertAdmin();
  const parsed = collectionInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid collection");
  input = parsed.data;

  let previousSlug: string | null = null;
  if (input.id) {
    previousSlug = await getCollectionSlugById(admin, input.id);
  }

  const refs = await loadExistingProductRefs(admin);
  const slug = input.slug?.trim()
    ? makeUniqueSlug(input.slug, new Set(withoutValue(refs.collectionSlugs, input.id)))
    : makeUniqueSlug(input.name, new Set(withoutValue(refs.collectionSlugs, input.id)));

  const row = {
    name: input.name,
    slug,
    description: input.description,
    image_url: input.image_url,
    is_active: input.is_active,
    display_order: input.display_order,
  };

  let collectionId = input.id;
  if (collectionId) {
    const { error } = await admin.from("collections").update(row).eq("id", collectionId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await admin.from("collections").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    collectionId = data.id as string;
  }

  await admin.from("collection_products").delete().eq("collection_id", collectionId);
  if (input.product_ids.length > 0) {
    const { error } = await admin.from("collection_products").insert(
      input.product_ids.map((product_id, index) => ({
        collection_id: collectionId!,
        product_id,
        display_order: index,
      })),
    );
    if (error) throw new Error(error.message);
  }

  if (previousSlug && previousSlug !== slug) {
    revalidatePath(`/collections/${previousSlug}`);
  }
  revalidateCatalogShell();
  revalidatePath(`/collections/${slug}`);
  return { id: collectionId };
}

export async function reorderCollectionProducts(collectionId: string, productIds: string[]) {
  const { admin } = await assertAdmin();
  const slug = await getCollectionSlugById(admin, collectionId);

  if (productIds.length === 0) {
    const { error: clearError } = await admin
      .from("collection_products")
      .delete()
      .eq("collection_id", collectionId);
    if (clearError) throw new Error(clearError.message);
  } else {
    const { error: deleteError } = await admin
      .from("collection_products")
      .delete()
      .eq("collection_id", collectionId)
      .not("product_id", "in", `(${productIds.join(",")})`);
    if (deleteError) throw new Error(deleteError.message);
  }

  const { error } = await admin
    .from("collection_products")
    .upsert(
      productIds.map((product_id, index) => ({
        collection_id: collectionId,
        product_id,
        display_order: index,
      })),
      { onConflict: "collection_id,product_id" },
    );
  if (error) throw new Error(error.message);
  if (slug) revalidatePath(`/collections/${slug}`);
  revalidateCatalogShell();
}

