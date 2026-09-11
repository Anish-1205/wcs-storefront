import { Children } from "react";
import { HOME_SECTIONS, type HomepageContent } from "@/lib/homepage-content";

export function HomepageSections({ config, children }: { config: HomepageContent; children: React.ReactNode }) {
  const sections = Children.toArray(children);
  return config.sections.filter((section) => section.visible).map((section) =>
    sections[HOME_SECTIONS.findIndex(([key]) => key === section.key)]);
}
