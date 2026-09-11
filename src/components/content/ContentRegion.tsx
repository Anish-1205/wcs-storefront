"use client";

import { Children, cloneElement, createContext, createElement, isValidElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ContentField, PageContentMap } from "@/lib/page-content";
import { contentImageSchema } from "@/lib/page-content";

const ContentContext = createContext<{ content: PageContentMap; editing: boolean }>({ content: {}, editing: false });
export function PageContentProvider({ initial, children }: { initial: PageContentMap; children?: ReactNode }) {
  const [preview, setPreview] = useState<PageContentMap | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (window.parent === window || !new URLSearchParams(location.search).has("contentEditor")) return;
    setEditing(true);
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "content-preview") return;
      setPreview(event.data.content);
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "content-ready" }, location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  return createElement(ContentContext.Provider, { value: { content: preview ?? initial, editing } }, children);
}

/** Changes text/media before rendering, including SSR. No HTML injection. */
export function ContentRegion({ region, global = false, children }: { region: string; global?: boolean; children?: ReactNode }) {
  const pathname = usePathname();
  const { content, editing } = useContext(ContentContext);
  const scope = global ? "global" : pathname;
  const result = useMemo(() => {
    const overrides = content[scope] ?? {};
    const fields: ContentField[] = [];
    function walk(node: ReactNode, path: string): ReactNode {
      const key = `${region}:${path}`;
      if (typeof node === "string" && /[\p{L}\p{N}]/u.test(node)) {
        fields.push({ key, scope, kind: "text", label: node.trim(), value: node });
        return overrides[key]?.kind === "text" ? overrides[key].value : node;
      }
      if (!isValidElement<Record<string, unknown>>(node)) return node;
      const props = node.props;
      if (typeof props.region === "string") return node;
      if (typeof node.type === "string" && ["script", "style", "svg", "textarea", "input", "option"].includes(node.type)) return node;
      const changes: Record<string, unknown> = {};
      if (typeof props.alt === "string" && props.alt.trim()) {
        const altKey = `${key}:alt`;
        fields.push({ key: altKey, scope, kind: "text", label: `Image description: ${props.alt}`, value: props.alt });
        if (overrides[altKey]?.kind === "text") changes.alt = overrides[altKey].value;
      }
      if (typeof props.src === "string" && !/\.(mp4|webm|mov)(\?|$)/i.test(props.src)) {
        const imageKey = `${key}:image`;
        fields.push({ key: imageKey, scope, kind: "image", label: String(props.alt || "Image"), value: props.src });
        if (overrides[imageKey]?.kind === "image" && contentImageSchema.safeParse(overrides[imageKey].value).success) changes.src = overrides[imageKey].value;
      }
      if (typeof props.poster === "string") {
        const posterKey = `${key}:poster`;
        fields.push({ key: posterKey, scope, kind: "image", label: `${props.alt || "Video"} — poster`, value: props.poster });
        if (overrides[posterKey]?.kind === "image" && contentImageSchema.safeParse(overrides[posterKey].value).success) changes.poster = overrides[posterKey].value;
      }
      if (node.type === "section" && scope !== "/") {
        const sectionKey = `${key}:section`;
        fields.push({ key: sectionKey, scope, kind: "section", label: String(props["aria-label"] || props.id || `Section ${fields.filter((f) => f.kind === "section").length + 1}`), value: true });
        if (overrides[sectionKey]?.kind === "section" && !overrides[sectionKey].value) {
          changes.hidden = true;
          changes.style = { ...(props.style as object ?? {}), display: "none" };
        }
      }
      // Native child text and explicitly passed JSX remain editable; component
      // internals declare their own regions to keep identifiers independent.
      if (props.children != null) changes.children = Children.map(props.children as ReactNode, (child, index) =>
        walk(child, `${path}.${isValidElement(child) && child.key != null ? encodeURIComponent(String(child.key)) : index}`));
      return cloneElement(node, changes);
    }
    return { node: walk(children, "root"), fields };
  }, [children, region, scope, content]);
  const serialized = JSON.stringify(result.fields);
  useEffect(() => {
    if (editing) window.parent.postMessage({ type: "content-fields", region, scope, fields: JSON.parse(serialized) }, location.origin);
  }, [editing, region, scope, serialized]);
  return result.node;
}
