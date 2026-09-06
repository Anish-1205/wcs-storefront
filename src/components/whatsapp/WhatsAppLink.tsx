"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { buildWhatsAppURL, type WhatsAppOpts } from "@/lib/whatsapp";
import { analytics } from "@/lib/analytics";

interface WhatsAppLinkProps
  extends WhatsAppOpts,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> {
  /** Where on the site this CTA lives, e.g. "product", "float", "about". */
  sourcePage: string;
  productId?: string;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * Single source of truth for every WhatsApp CTA on the storefront: builds the
 * wa.me link and fires the `whatsapp_click` analytics event on click. Each
 * call site keeps its own visual styling via `className`/`children`.
 */
export function WhatsAppLink({
  sourcePage,
  productId,
  productName,
  productCode,
  variantColor,
  disabled,
  children,
  ...anchorProps
}: WhatsAppLinkProps) {
  const href = buildWhatsAppURL({ productName, productCode, variantColor });

  return (
    <a
      {...anchorProps}
      href={disabled ? undefined : href}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={disabled}
      onClick={() =>
        !disabled &&
        analytics.whatsappClick({
          product_id: productId,
          source_page: sourcePage,
          variant_color: variantColor ?? undefined,
        })
      }
    >
      {children}
    </a>
  );
}
