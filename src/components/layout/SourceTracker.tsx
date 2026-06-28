"use client";

import { useEffect } from "react";
import { captureSource } from "@/lib/source-tracking";

/** Captures lead-source attribution once on first public page load. */
export function SourceTracker() {
  useEffect(() => {
    captureSource();
  }, []);
  return null;
}
