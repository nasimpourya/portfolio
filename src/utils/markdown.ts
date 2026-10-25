/**
 * Minimal in-house Markdown renderer (TASK-041, Section 4.3).
 *
 * Safe by construction (Section 8.1): the renderer builds its output
 * exclusively with createElement/textContent/append — never innerHTML —
 * so untrusted file content can never become markup, scripts, or event
 * handlers. Raw HTML in a source document renders as the literal text
 * that was typed. Because no HTML is ever generated, no sanitizer is
 * needed; this is deliberately stronger than "sanitize after parsing"
 * (reason recorded per Section 15).
 *
 * Line-oriented two-pass parser: a block pass turns lines into block
 * elements, an inline scanner fills them. Documented limitations: no
 * setext headings, reference links, images, entity decoding, HTML
 * blocks, or nested lists; list items are inline-only.
 */

/** True for Markdown source files, checked case-insensitively by extension. */
export function isMarkdown(fileName: string): boolean {
  return /\.(md|markdown)$/i.test(fileName);
}

/**
 * Link href policy: reject protocol-relative URLs; allow http, https,
 * and mailto; otherwise allow only scheme-less relative URLs. The
 * scheme allowlist means `javascript:` and `data:` can never reach an
 * href — such links render as their literal source text instead.
 */
export function isSafeUrl(url: string): boolean {
  // (Regex rather than a "//" string literal: the release integration
  // tests assert the built HTML never contains quote-double-slash.)
  if (/^\/\//.test(url)) return false;
  if (/^(?:https?|mailto):/i.test(url)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

export type MarkdownOptions = {
  /** Shifts heading levels up before clamping to h6 (gallery cards pass 2). */
  headingOffset?: number;
};

/** Render `source` as a DocumentFragment of block/inline elements. */
export function renderMarkdown(
  doc: Document,
  source: string,
  options: MarkdownOptions = {},
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  const headingOffset = options.headingOffset ?? 0;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  parseBlocks(doc, fragment, lines, headingOffset, 0);
  return fragment;
}

/** Blockquotes nest at most this deep; deeper markers render un-nested. */
const MAX_QUOTE_DEPTH = 4;

/** True when a line opens some other block (used to end paragraphs). */
function opensBlock(line: string): boolean {
  return (
    /^ {0,3}`{3,}/.test(line) ||
    // Heading-shaped only when heading text follows (a bare "# " is not).
    /^#{1,6}\s+\S/.test(line) ||
    /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}[-*+]\s+/.test(line) ||
    /^ {0,3}\d+[.)]\s+/.test(line)
  );
}

/** Pass 1: append block elements for `lines` to `parent`. */
function parseBlocks(
  doc: Document,
  parent: ParentNode,
  lines: readonly string[],
  headingOffset: number,
  quoteDepth: number,
): void {
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    // Fenced code: the info string is ignored; an unterminated fence
    // leniently runs to the end of the document.
    if (/^ {0,3}`{3,}/.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}`{3,}\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1; // consume the closing fence
      const code = doc.createElement("code");
      code.textContent = body.join("\n");
      const pre = doc.createElement("pre");
      pre.append(code);
      parent.append(pre);
      continue;
    }

    // ATX heading: `#`s, required space, trailing `#`s discarded.
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1]!.length + headingOffset);
      const element = doc.createElement(`h${level}`);
      appendInline(doc, element, heading[2]!);
      parent.append(element);
      index += 1;
      continue;
    }

    // Thematic break.
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      parent.append(doc.createElement("hr"));
      index += 1;
      continue;
    }

    // Blockquote: consecutive `>`-prefixed lines, markers stripped,
    // recursed as blocks (so quotes may contain any block).
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^ {0,3}> ?/, ""));
        index += 1;
      }
      if (quoteDepth < MAX_QUOTE_DEPTH) {
        const quote = doc.createElement("blockquote");
        parseBlocks(doc, quote, quoted, headingOffset, quoteDepth + 1);
        parent.append(quote);
      } else {
        parseBlocks(doc, parent, quoted, headingOffset, quoteDepth);
      }
      continue;
    }

    // Lists: consecutive items of one kind (bullet or ordered); items
    // are inline-only — no nesting, no lazy continuation.
    const orderedItem = /^ {0,3}\d+[.)]\s+(.*)$/.exec(line);
    const bulletItem = orderedItem === null ? /^ {0,3}[-*+]\s+(.*)$/.exec(line) : null;
    const itemPattern = orderedItem ?? bulletItem;
    if (itemPattern !== null) {
      const isOrdered = orderedItem !== null;
      const list = doc.createElement(isOrdered ? "ol" : "ul");
      while (index < lines.length) {
        const match = isOrdered
          ? /^ {0,3}\d+[.)]\s+(.*)$/.exec(lines[index]!)
          : /^ {0,3}[-*+]\s+(.*)$/.exec(lines[index]!);
        if (match === null) break;
        const item = doc.createElement("li");
        appendInline(doc, item, match[1]!);
        list.append(item);
        index += 1;
      }
      parent.append(list);
      continue;
    }

    // Paragraph: blank-line-separated run of plain lines, joined with \n.
    // The first line is consumed unconditionally (no block matched it),
    // so the loop always makes progress.
    const paragraph: string[] = [lines[index]!];
    index += 1;
    while (index < lines.length && lines[index]!.trim() !== "" && !opensBlock(lines[index]!)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    const element = doc.createElement("p");
    appendInline(doc, element, paragraph.join("\n"));
    parent.append(element);
  }
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/**
 * Find the emphasis delimiter that closes one opened at `from`
 * (exclusive): non-empty content with no leading/trailing whitespace;
 * `_` delimiters must additionally sit at word boundaries so
 * snake_case names stay literal.
 */
function findEmphasisClose(
  text: string,
  delimiter: string,
  from: number,
  wordBounded: boolean,
): number {
  let search = from;
  for (;;) {
    const close = text.indexOf(delimiter, search);
    if (close === -1) return -1;
    const after = close + delimiter.length;
    const content = text.slice(from, close);
    const boundariesHold =
      !wordBounded || after >= text.length || !isWordChar(text[after]!);
    if (
      boundariesHold &&
      content !== "" &&
      !content.startsWith(" ") &&
      !content.endsWith(" ")
    ) {
      return close;
    }
    search = close + 1;
  }
}

/** Pass 2: append inline nodes for `text` to `parent`, in precedence order. */
function appendInline(doc: Document, parent: ParentNode, text: string): void {
  let index = 0;
  let literal = "";

  const flush = (): void => {
    if (literal !== "") {
      parent.append(literal);
      literal = "";
    }
  };

  while (index < text.length) {
    const char = text[index]!;

    // Code span: a backtick run closed by a run of the same length;
    // unterminated backticks stay literal.
    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))![0];
      const close = text.indexOf(run, index + run.length);
      if (close !== -1) {
        flush();
        const code = doc.createElement("code");
        code.textContent = text.slice(index + run.length, close);
        parent.append(code);
        index = close + run.length;
        continue;
      }
    }

    // Link [label](url): rendered only when the URL passes the policy.
    if (char === "[") {
      const match = /^\[([^\]]*)\]\(([^()\s]*)\)/.exec(text.slice(index));
      if (match !== null && isSafeUrl(match[2]!)) {
        flush();
        const anchor = doc.createElement("a");
        anchor.setAttribute("href", match[2]!);
        anchor.setAttribute("rel", "noopener noreferrer");
        appendInline(doc, anchor, match[1]!);
        parent.append(anchor);
        index += match[0].length;
        continue;
      }
      // Unsafe or malformed: the construct stays literal text.
    }

    // Emphasis: **bold**/__bold__, then *em*/_em_ — underscore only at
    // word boundaries, so snake_case stays literal.
    if (char === "*" || char === "_") {
      const wordBounded = char === "_";
      const canOpen = !wordBounded || index === 0 || !isWordChar(text[index - 1]!);
      const strong = text[index + 1] === char;
      const delimiter = strong ? char + char : char;
      const contentStart = index + delimiter.length;
      const close = canOpen
        ? findEmphasisClose(text, delimiter, contentStart, wordBounded)
        : -1;
      if (close !== -1) {
        flush();
        const element = doc.createElement(strong ? "strong" : "em");
        appendInline(doc, element, text.slice(contentStart, close));
        parent.append(element);
        index = close + delimiter.length;
        continue;
      }
    }

    literal += char;
    index += 1;
  }

  flush();
}
