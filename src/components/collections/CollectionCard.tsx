import Image from "next/image";
import Link from "next/link";
import { cld } from "@/lib/cloudinary";
import type { Collection } from "@/lib/supabase/types";

export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group relative block aspect-[16/10] overflow-hidden rounded-sm bg-secondary"
    >
      {collection.image_url ? (
        <>
          <Image
            src={cld(collection.image_url, "card")}
            alt={collection.name}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-black/10" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gold/70 to-burgundy" />
      )}
      {!collection.image_url && <div className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/40" />}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
        <h3 className="font-serif text-2xl text-white drop-shadow">
          {collection.name}
        </h3>
        <span className="mt-2 text-xs uppercase tracking-[0.2em] text-gold-light">
          Explore collection →
        </span>
      </div>
    </Link>
  );
}
