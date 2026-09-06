"use client";

import { analytics } from "@/lib/analytics";

interface PinterestSaveButtonProps {
  productId: string;
  imageUrl: string;
  pageUrl: string;
  description: string;
  className?: string;
}

/**
 * Opens Pinterest's own pin-creation flow — no Pinterest SDK/script needed,
 * just their documented `pin/create/button` URL. Styled as a quiet chip (like
 * WhatsAppFloat), not the default red Pinterest badge.
 */
export function PinterestSaveButton({
  productId,
  imageUrl,
  pageUrl,
  description,
  className,
}: PinterestSaveButtonProps) {
  const href = `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(
    pageUrl,
  )}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(description)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => analytics.pinterestShare({ product_id: productId })}
      aria-label="Save to Pinterest"
      className={className}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
        <path d="M12 0a12 12 0 00-4.373 23.178c-.035-.947-.007-2.086.235-3.117.26-1.1 1.75-7.42 1.75-7.42s-.447-.892-.447-2.212c0-2.07 1.2-3.617 2.694-3.617 1.271 0 1.885.955 1.885 2.1 0 1.28-.816 3.19-1.237 4.96-.352 1.48.744 2.687 2.207 2.687 2.65 0 4.428-3.405 4.428-7.436 0-3.065-2.064-5.36-5.822-5.36-4.245 0-6.888 3.166-6.888 6.7 0 1.22.36 2.079.92 2.744.258.306.294.43.2.78-.066.256-.219.868-.282 1.11-.093.353-.38.48-.7.35-1.95-.795-2.858-2.927-2.858-5.325 0-3.96 3.34-8.71 9.965-8.71 5.325 0 8.826 3.855 8.826 7.99 0 5.472-3.05 9.556-7.549 9.556-1.51 0-2.93-.808-3.416-1.73l-.93 3.663c-.336 1.216-.996 2.433-1.594 3.383A12 12 0 1012 0z" />
      </svg>
    </a>
  );
}
