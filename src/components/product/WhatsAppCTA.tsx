"use client";

import { buildWhatsAppURL } from "@/lib/whatsapp";
import { analytics } from "@/lib/analytics";
import { Button } from "@/components/ui/button";

interface Props {
  productId: string;
  productName: string;
  productCode?: string | null;
  variantColor?: string | null;
  disabled?: boolean;
}

/** Primary product conversion button — opens WhatsApp with a pre-filled message. */
export function WhatsAppCTA({
  productId,
  productName,
  productCode,
  variantColor,
  disabled,
}: Props) {
  const href = buildWhatsAppURL({ productName, productCode, variantColor });

  return (
    <a
      href={disabled ? undefined : href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        !disabled &&
        analytics.whatsappClick({
          product_id: productId,
          source_page: "product",
          variant_color: variantColor ?? undefined,
        })
      }
      aria-disabled={disabled}
      className={disabled ? "pointer-events-none" : ""}
    >
      <Button variant="whatsapp" size="lg" className="w-full" disabled={disabled}>
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413-.074-.124-.272-.198-.57-.347Z" />
        </svg>
        {disabled ? "Currently sold out" : "Enquire on WhatsApp"}
      </Button>
    </a>
  );
}
