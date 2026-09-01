// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { PREVIEW_CHARACTER_LIMIT, renderMarkdownPreview } from "./markdown-preview";

function render(source: string): string {
  const host = document.createElement("div");
  host.replaceChildren(renderMarkdownPreview(source));
  return host.innerHTML;
}

describe("Markdown preview rendering", () => {
  it("renders common Markdown structures", () => {
    const rendered = render(
      "# Heading\n\n**strong**\n\n- item\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    );

    expect(rendered).toContain("<h1>Heading</h1>");
    expect(rendered).toContain("<strong>strong</strong>");
    expect(rendered).toContain("<li>item</li>");
    expect(rendered).toContain("<table>");
  });

  it("shows whether each task list item is done", () => {
    const rendered = render("- [x] 完了\n- [ ] 未着手");

    expect(rendered).toContain("☑︎ 完了");
    expect(rendered).toContain("☐︎ 未着手");
  });

  it("keeps task list state visible without letting input elements through", () => {
    const rendered = render("- [x] 完了");

    expect(rendered).toContain("☑︎");
    expect(rendered).not.toContain("<input");
    expect(rendered).not.toContain("checked");
    expect(rendered).not.toContain("disabled");
  });

  it("removes executable HTML and unsafe URLs", () => {
    const rendered = render(
      '<script>alert(1)</script><style>body{display:none}</style><iframe src="file:///secret"></iframe><img src="data:image/png;base64,x" onerror="alert(2)"><a class="toast toast--visible">fake</a><input type="text" value="fake">\n\n[unsafe](javascript:alert(3))\n\n[local](file:///secret)\n\n[safe](https://example.com)',
    );

    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("<style");
    expect(rendered).not.toContain("<iframe");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("<input");
    expect(rendered).not.toContain("class=");
    expect(rendered).not.toContain("onerror");
    expect(rendered).not.toContain("javascript:");
    expect(rendered).not.toContain("file:");
    expect(rendered).not.toContain("href=");
  });

  it("returns an empty preview for an empty document", () => {
    expect(render("")).toBe("");
  });

  it("defines a bounded synchronous preview size", () => {
    expect(PREVIEW_CHARACTER_LIMIT).toBe(2 * 1024 * 1024);
  });
});
