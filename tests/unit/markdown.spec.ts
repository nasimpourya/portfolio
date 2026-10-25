// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isMarkdown,
  isSafeUrl,
  renderMarkdown,
} from "../../src/utils/markdown";

/**
 * Markdown renderer specs (TASK-041, Section 4.3): block structure,
 * inline precedence, and — above all — content safety. The renderer
 * must be safe by construction (Section 8.1): raw HTML, event-handler
 * attributes, and unsafe link schemes render as literal text because
 * nothing is ever parsed as HTML.
 */

const doc = document;

/** Render into a detached container and return it for querying. */
function render(source: string, options?: { headingOffset?: number }) {
  const host = doc.createElement("div");
  host.append(renderMarkdown(doc, source, options));
  return host;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isMarkdown", () => {
  it("accepts .md and .markdown regardless of case", () => {
    expect(isMarkdown("notes.md")).toBe(true);
    expect(isMarkdown("notes.MD")).toBe(true);
    expect(isMarkdown("retrospective.markdown")).toBe(true);
    expect(isMarkdown("draft.MarkDown")).toBe(true);
  });

  it("rejects other names", () => {
    expect(isMarkdown("notes.txt")).toBe(false);
    expect(isMarkdown("readme.md.bak")).toBe(false);
    expect(isMarkdown("md")).toBe(false);
    expect(isMarkdown("")).toBe(false);
  });
});

describe("renderMarkdown — blocks", () => {
  it("renders ATX headings at their level", () => {
    const host = render("# Title\n\n## Sub\n\n###### Deep");
    expect([...host.children].map((el) => el.tagName)).toEqual([
      "H1",
      "H2",
      "H6",
    ]);
    expect(host.querySelector("h1")!.textContent).toBe("Title");
  });

  it("seven hashes are a paragraph, not a heading (CommonMark shape)", () => {
    const host = render("####### not a heading");
    expect(host.querySelector("p")!.textContent).toBe("####### not a heading");
  });

  it("discards closing heading hashes", () => {
    expect(render("## Title ##").querySelector("h2")!.textContent).toBe("Title");
  });

  it("requires a space after the hashes", () => {
    expect(render("#hashtag").querySelector("p")!.textContent).toBe("#hashtag");
  });

  it("applies and clamps the heading offset", () => {
    // Gallery cards render under the h2 date heading (TASK-041).
    const host = render("# Title\n\n#### Deep", { headingOffset: 2 });
    expect([...host.children].map((el) => el.tagName)).toEqual(["H3", "H6"]);
    expect(render("###### Deep", { headingOffset: 2 }).firstElementChild!.tagName).toBe("H6");
  });

  it("separates paragraphs on blank lines and joins soft breaks with \\n", () => {
    const host = render("first line\nsecond line\n\nsecond paragraph");
    const paragraphs = [...host.querySelectorAll("p")];
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]!.textContent).toBe("first line\nsecond line");
    expect(paragraphs[1]!.textContent).toBe("second paragraph");
  });

  it("renders thematic breaks", () => {
    for (const marker of ["---", "***", "___"]) {
      expect(render(`a\n\n${marker}\n\nb`).querySelector("hr")).not.toBeNull();
    }
  });

  it("renders bullet and ordered lists with inline-only items", () => {
    const host = render("- one\n- **two**\n\n1. first\n2) second");
    const [unordered, ordered] = [...host.querySelectorAll("ul, ol")];
    expect(unordered!.tagName).toBe("UL");
    expect([...unordered!.children].map((li) => li.textContent)).toEqual([
      "one",
      "two",
    ]);
    expect(unordered!.children[1]!.firstElementChild!.tagName).toBe("STRONG");
    expect(ordered!.tagName).toBe("OL");
    expect([...ordered!.children].map((li) => li.textContent)).toEqual([
      "first",
      "second",
    ]);
  });

  it("renders blockquotes, nested, up to a depth cap", () => {
    const host = render("> outer\n> > inner");
    const quotes = [...host.querySelectorAll("blockquote")];
    expect(quotes).toHaveLength(2);
    expect(quotes[1]!.parentElement).toBe(quotes[0]); // genuinely nested
    expect(quotes[0]!.querySelector("p")!.textContent).toBe("outer");
    expect(quotes[1]!.querySelector("p")!.textContent).toBe("inner");

    const deep = render(">>>>> too deep");
    expect(deep.querySelectorAll("blockquote")).toHaveLength(4);
    expect(deep.querySelector("blockquote p")!.textContent).toContain("too deep");
  });

  it("renders fenced code verbatim with the info string ignored", () => {
    const host = render("```js\nconst x = '<b>not html</b>';\n**not bold**\n```");
    const code = host.querySelector("pre code")!;
    expect(code.textContent).toBe("const x = '<b>not html</b>';\n**not bold**");
    expect(code.firstElementChild).toBeNull(); // contents never parsed
  });

  it("leniently closes an unterminated fence at end of input", () => {
    const host = render("before\n\n```\nunterminated `code`");
    expect(host.querySelector("p")!.textContent).toBe("before");
    expect(host.querySelector("pre code")!.textContent).toBe(
      "unterminated `code`",
    );
  });

  it("normalizes CRLF line endings", () => {
    const host = render("# Title\r\n\r\nbody line\r\nnext");
    expect(host.querySelector("h1")!.textContent).toBe("Title");
    expect(host.querySelector("p")!.textContent).toBe("body line\nnext");
  });

  it("renders empty input as an empty fragment", () => {
    const host = render("");
    expect(host.childElementCount).toBe(0);
    expect(host.textContent).toBe("");
  });
});

describe("renderMarkdown — inline", () => {
  it("renders bold and emphasis in both delimiter styles", () => {
    const host = render("**a** __b__ *c* _d_");
    expect(host.querySelector("p")!.innerHTML).not.toContain("*"); // sanity below
    const tags = [...host.querySelector("p")!.children].map((el) => el.tagName);
    expect(tags).toEqual(["STRONG", "STRONG", "EM", "EM"]);
    expect(host.querySelector("strong")!.textContent).toBe("a");
    expect(host.querySelector("em")!.textContent).toBe("c");
  });

  it("keeps snake_case and intraword underscores literal", () => {
    const host = render("snake_case_name and foo_bar_baz");
    expect(host.querySelector("p")!.children).toHaveLength(0);
    expect(host.querySelector("p")!.textContent).toBe("snake_case_name and foo_bar_baz");
  });

  it("does not emphasize across whitespace padding", () => {
    const host = render("** bold ** and _ x _");
    expect(host.querySelector("p")!.children).toHaveLength(0);
  });

  it("renders code spans, preserving their content verbatim", () => {
    const host = render("`<b>literal</b>` and `**not bold**`");
    const codes = [...host.querySelectorAll("code")];
    expect(codes.map((code) => code.textContent)).toEqual([
      "<b>literal</b>",
      "**not bold**",
    ]);
    expect(codes[0]!.childElementCount).toBe(0);
  });

  it("leaves unterminated backticks as literal text", () => {
    expect(render("`oops").querySelector("p")!.textContent).toBe("`oops");
  });

  it("renders links with safe hrefs and rel attributes", () => {
    const host = render("[site](https://example.com/a?b=c) and [mail](mailto:x@y.z) and [rel](../page)");
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a?b=c",
      "mailto:x@y.z",
      "../page",
    ]);
    for (const link of links) {
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBeNull(); // plain navigation
    }
    expect(links[0]!.textContent).toBe("site");
  });

  it("renders inline markup inside link labels", () => {
    const link = render("[**bold** label](https://example.com)").querySelector("a")!;
    expect(link.querySelector("strong")!.textContent).toBe("bold");
  });

  it("neutralizes javascript:, data:, and protocol-relative hrefs to literal text", () => {
    const host = render(
      "[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.example/x)",
    );
    expect(host.querySelector("p")!.children).toHaveLength(0);
    expect(host.querySelector("p")!.textContent).toBe(
      "[a](javascript:alert(1)) [b](data:text/html,x) [c](//evil.example/x)",
    );
  });

  it("raw HTML stays literal text — never elements, scripts, or handlers", () => {
    const payload =
      '<script>alert("x")<\/script><img src=x onerror="alert(1)"><b onclick="go()">bold</b>&amp;';
    const host = render(payload);
    const paragraph = host.querySelector("p")!;
    expect(paragraph.textContent).toBe(payload); // exactly as typed
    expect(paragraph.firstElementChild).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
  });

  it("code spans win over emphasis and links inside them", () => {
    const host = render("`**not bold** and [not a](https://link.example)`");
    const code = host.querySelector("code")!;
    expect(code.textContent).toBe("**not bold** and [not a](https://link.example)");
    expect(host.querySelector("strong")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
  });
});

describe("isSafeUrl", () => {
  it("allows http, https, mailto, and scheme-less relative URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com/a")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("projects/2026/notes.txt")).toBe(true);
    expect(isSafeUrl("/absolute/path")).toBe(true);
    expect(isSafeUrl("#fragment")).toBe(true);
  });

  it("rejects protocol-relative and other schemes", () => {
    expect(isSafeUrl("//example.com")).toBe(false);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("vbscript:x")).toBe(false);
  });
});
