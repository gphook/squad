import { describe, it, expect } from "vitest";
import { renderMarkdown, fileUrl } from "../src/lib/markdown.ts";

const ctx = { projectId: "p1", agentId: "a1" };

describe("renderMarkdown", () => {
  it("strips script tags and inline handlers", () => {
    const html = renderMarkdown('hi <script>alert(1)</script><img src="x.png" onerror="alert(1)">', ctx);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
  it("rewrites a local image to the /files route", () => {
    expect(renderMarkdown("![x](captures/a.png)", ctx)).toContain('src="/files?project=p1&amp;agent=a1&amp;path=captures%2Fa.png"');
  });
  it("does not throw on a malformed % escape in an image path", () => {
    expect(renderMarkdown("![x](growth%.png)", ctx)).toContain("path=growth%25.png");
  });
  it("does not load external images, offering a link instead", () => {
    const html = renderMarkdown("![x](https://e.com/a.png)", ctx);
    expect(html).not.toContain("<img");
    expect(html).toContain("Load image");
    expect(html).toContain('data-src="https://e.com/a.png"');
  });
  it("opens links in a new tab without opener", () => {
    const html = renderMarkdown("[l](https://e.com)", ctx);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe("fileUrl", () => {
  it("builds a /files URL without agent for shared files", () => {
    expect(fileUrl({ projectId: "p1" }, "/s/x.md")).toBe("/files?project=p1&path=%2Fs%2Fx.md");
  });
});
