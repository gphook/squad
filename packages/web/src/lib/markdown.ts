import { marked } from "marked";
import DOMPurify from "dompurify";
import { isExternalUrl } from "@squad/shared";

export interface FileCtx { projectId: string; agentId?: string }

export function fileUrl(ctx: FileCtx, path: string, download = false): string {
  const q = new URLSearchParams({ project: ctx.projectId });
  if (ctx.agentId) q.set("agent", ctx.agentId);
  q.set("path", path);
  if (download) q.set("download", "1");
  return `/files?${q}`;
}

function safeDecode(s: string): string {
  try { return decodeURI(s); } catch { return s; }
}

/** Agent markdown → safe HTML: sanitised, local images served via /files, external images click-to-load. */
export function renderMarkdown(md: string, ctx: FileCtx, opts: { breaks?: boolean } = {}): string {
  const raw = marked.parse(md, { async: false, gfm: true, breaks: opts.breaks ?? false }) as string;
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  for (const img of [...root.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? "";
    if (isExternalUrl(src) || src.startsWith("data:")) {
      const a = doc.createElement("a");
      a.className = "ext-img";
      a.setAttribute("href", "#");
      a.setAttribute("data-src", src);
      a.textContent = `Load image${img.alt ? `: ${img.alt}` : ""}`;
      img.replaceWith(a);
    } else {
      img.setAttribute("src", fileUrl(ctx, safeDecode(src)));
      img.setAttribute("loading", "lazy");
      img.classList.add("thumb");
    }
  }
  for (const a of [...root.querySelectorAll("a[href]")]) {
    if (a.classList.contains("ext-img")) continue;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
  return root.innerHTML;
}
