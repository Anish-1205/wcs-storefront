"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { VariantManager } from "./VariantManager";
import { CollectionCheckboxes } from "./CollectionCheckboxes";
import { saveProduct, saveCategory } from "@/app/admin/actions";
import { slugify } from "@/lib/utils";
import type { Category, Collection } from "@/lib/supabase/types";
import type { ProductInputShape, VariantInputShape } from "@/lib/validation";

export type ProductFormInitial = Partial<ProductInputShape> & {
  variants: VariantInputShape[];
  collection_ids: string[];
  /** Display-only: not part of the save payload. Set when this product was
   * created by the storefront file sync rather than authored in admin. */
  source?: "admin" | "file_sync";
};

interface Props {
  categories: Category[];
  collections: Pick<Collection, "id" | "name">[];
  initial?: ProductFormInitial;
}

export function ProductForm({ categories, collections, initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? "");
  const [categoryOptions, setCategoryOptions] = useState<Pick<Category, "id" | "name">[]>(categories);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  async function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    setCategoryError(null);
    const result = await saveCategory({
      name,
      slug: null,
      description: null,
      image_url: null,
      display_order: categoryOptions.length,
    });
    setCreatingCategory(false);
    if (!result.ok) {
      setCategoryError(result.error);
      return;
    }
    setCategoryOptions((prev) =>
      [...prev, { id: result.id, name }].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCategoryId(result.id);
    setNewCategoryName("");
    setShowNewCategory(false);
  }
  const [fabric, setFabric] = useState(initial?.fabric_type ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [highlights, setHighlights] = useState(
    (initial?.highlights ?? []).join("\n"),
  );
  const [priceMin, setPriceMin] = useState<string>(
    initial?.base_price_min != null ? String(initial.base_price_min) : "",
  );
  const [priceMax, setPriceMax] = useState<string>(
    initial?.base_price_max != null ? String(initial.base_price_max) : "",
  );
  const [status, setStatus] = useState<ProductInputShape["status"]>(
    initial?.status ?? "draft",
  );
  const [productCode, setProductCode] = useState(initial?.product_code ?? "");
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [stockType, setStockType] = useState<ProductInputShape["stock_type"]>(
    initial?.stock_type ?? "supplier",
  );
  const [variants, setVariants] = useState<VariantInputShape[]>(initial?.variants ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    initial?.collection_ids ?? [],
  );
  const isFileSynced = initial?.source === "file_sync";

  const anyVariantPriced = variants.some((v) => v.price_min != null);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Name is required.");
    if (variants.some((v) => !v.color.trim()))
      return setError("Every variant needs a color name.");

    setSaving(true);
    const payload: ProductInputShape = {
      id: initial?.id,
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      category_id: categoryId || null,
      fabric_type: fabric.trim() || null,
      description: description.trim() || null,
      highlights: highlights
        .split("\n")
        .map((h: string) => h.trim())
        .filter(Boolean),
      base_price_min: priceMin ? Number(priceMin) : null,
      base_price_max: priceMax ? Number(priceMax) : null,
      status,
      product_code: productCode.trim() || null,
      is_featured: isFeatured,
      stock_type: stockType,
      variants: variants.map((v, i) => ({ ...v, display_order: i })),
      collection_ids: collectionIds,
    };

    try {
      const result = await saveProduct(payload);
      if (!result.ok) {
        setError(result.error);
        setSaving(false);
        return;
      }
      router.push("/admin/products");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save product.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {isFileSynced && (
        <div className="rounded-sm border border-[#B8860B]/40 bg-[#B8860B]/10 p-4 text-sm text-primary">
          This product is synced from the live storefront (
          <code className="text-xs">src/data/products.ts</code>). Edits made
          here are for internal reference only — they won&apos;t change the
          live site. Update the source file and re-run &ldquo;Sync storefront
          products&rdquo; instead.
        </div>
      )}

      {/* Core fields */}
      <section className="rounded-sm border border-border bg-card p-6">
        <h2 className="mb-4 font-serif text-lg text-primary">Product details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" value={name} onChange={(e) => onNameChange(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="auto-generated"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Product code</Label>
            <Input
              id="code"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value)}
              placeholder="e.g. GAD-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fabric">Fabric type</Label>
            <Input id="fabric" value={fabric} onChange={(e) => setFabric(e.target.value)} placeholder="e.g. Pure Silk" />
          </div>
          {anyVariantPriced ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Base price (₹)</Label>
              <p className="text-sm text-muted-foreground">
                Hidden — every color variant below has its own price. Clear all
                variant prices to set a base price again.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pmin">Base price min (₹)</Label>
                <Input id="pmin" type="number" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pmax">Base price max (₹)</Label>
                <Input id="pmax" type="number" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[140px]"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="highlights">Highlights (one per line)</Label>
            <Textarea
              id="highlights"
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder={"Pure silk pallu\nHandwoven\nMatching blouse piece"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" value={status} onChange={(e) => setStatus(e.target.value as ProductInputShape["status"])}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock">Stock type</Label>
            <Select id="stock" value={stockType} onChange={(e) => setStockType(e.target.value as ProductInputShape["stock_type"])}>
              <option value="supplier">Supplier (sourced on order)</option>
              <option value="held">Held (in stock)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="h-4 w-4 accent-[#B8860B]"
            />
            Feature on homepage
          </label>
        </div>
      </section>

      {/* Category & Collections */}
      <section className="rounded-sm border border-border bg-card p-6">
        <h2 className="mb-4 font-serif text-lg text-primary">Categorize</h2>
        <div className="space-y-4">
          <div className="space-y-1.5 sm:max-w-xs">
            <div className="flex items-center justify-between">
              <Label htmlFor="category">Category (primary)</Label>
              <button
                type="button"
                className="text-xs text-primary underline underline-offset-2"
                onClick={() => {
                  setShowNewCategory((v) => !v);
                  setCategoryError(null);
                }}
              >
                {showNewCategory ? "Cancel" : "+ New category"}
              </button>
            </div>
            {showNewCategory ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void createCategory();
                    }
                  }}
                  placeholder="e.g. Silk Sarees"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={creatingCategory || !newCategoryName.trim()}
                  onClick={() => void createCategory()}
                >
                  {creatingCategory ? "Adding…" : "Add"}
                </Button>
              </div>
            ) : (
              <Select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— Select —</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {categoryError && <p className="text-xs text-destructive">{categoryError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Collections (tags)</Label>
            <CollectionCheckboxes
              collections={collections}
              selected={collectionIds}
              onChange={setCollectionIds}
            />
          </div>
        </div>
      </section>

      {/* Variants */}
      <section className="rounded-sm border border-border bg-card p-6">
        <h2 className="mb-4 font-serif text-lg text-primary">
          Color variants & images
        </h2>
        <VariantManager variants={variants} onChange={setVariants} />
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save product"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/products")}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
