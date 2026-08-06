"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { saveCategory } from "@/app/admin/actions";
import { slugify } from "@/lib/utils";
import type { CategoryInputShape } from "@/lib/validation";

export type CategoryFormInitial = Partial<CategoryInputShape>;

interface Props {
  initial?: CategoryFormInitial;
}

export function CategoryForm({ initial }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(initial?.display_order ?? 0));

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Name is required.");

    setSaving(true);
    try {
      await saveCategory({
        id: initial?.id,
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        description: description.trim() || null,
        image_url: imageUrl.trim() || null,
        display_order: Number(displayOrder) || 0,
      });
      router.push("/admin/categories");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save category.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section className="rounded-sm border border-border bg-white p-6">
        <h2 className="mb-4 font-serif text-lg text-burgundy">Category details</h2>
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
            <Label htmlFor="order">Display order</Label>
            <Input id="order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="image_url">Image URL</Label>
            <Input id="image_url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Cloudinary or image URL" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[140px]" />
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save category"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/categories")}>Cancel</Button>
      </div>
    </form>
  );
}