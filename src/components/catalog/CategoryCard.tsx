import Image from "next/image";
import Link from "next/link";
import { cld } from "@/lib/cloudinary";
import type { Category } from "@/lib/supabase/types";

export function CategoryCard({ category }: { category: Category }) {
  return (
    <Link
      href={`/catalog/${category.slug}`}
      className="group relative block aspect-[4/5] overflow-hidden rounded-sm bg-secondary"
    >
      {category.image_url ? (
        <Image
          src={cld(category.image_url, "card")}
          alt={`${category.name} sarees`}
          fill
          sizes="(max-width: 640px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-burgundy/80 to-burgundy-dark" />
      )}
      <div className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <h3 className="font-serif text-lg text-white drop-shadow">
          {category.name}
        </h3>
        <span className="text-xs uppercase tracking-widest text-gold-light">
          Shop now →
        </span>
      </div>
    </Link>
  );
}
