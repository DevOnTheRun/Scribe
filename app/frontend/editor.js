/**
 * Markdown editing helpers for the Edit tab: textarea wraps, rendered-mode
 * toolbar via execCommand, and a modest HTML → Markdown serializer.
 */

/** Wrap the current textarea selection (or insert markers at the caret). */
export function wrapTextareaSelection(textarea, before, after = before, placeholder = "text") {
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const inner = selected || placeholder;
  const next = value.slice(0, start) + before + inner + after + value.slice(end);
  textarea.value = next;
  const innerStart = start + before.length;
  if (selected) {
    textarea.setSelectionRange(innerStart, innerStart + inner.length);
  } else {
    textarea.setSelectionRange(innerStart, innerStart + inner.length);
  }
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Prefix each selected line (or the current line) with a block marker. */
export function prefixTextareaLines(textarea, prefix) {
  if (!textarea) return;
  const value = textarea.value;
  let start = textarea.selectionStart ?? 0;
  let end = textarea.selectionEnd ?? 0;
  while (start > 0 && value[start - 1] !== "\n") start -= 1;
  if (end > start && value[end - 1] === "\n") end -= 1;
  while (end < value.length && value[end] !== "\n") end += 1;
  const block = value.slice(start, end);
  const lines = block.split("\n").map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith(prefix)) return line;
    return prefix + line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
  });
  const next = value.slice(0, start) + lines.join("\n") + value.slice(end);
  textarea.value = next;
  textarea.setSelectionRange(start, start + lines.join("\n").length);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function insertTextareaSnippet(textarea, snippet) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const value = textarea.value;
  const next = value.slice(0, start) + snippet + value.slice(end);
  textarea.value = next;
  const caret = start + snippet.length;
  textarea.setSelectionRange(caret, caret);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

const LIST_LINE_RE = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/;
const LIST_INDENT_UNIT = "    ";

/** Increase or decrease Markdown list indent for the selected lines. */
export function indentTextareaListLines(textarea, direction = 1) {
  if (!textarea) return;
  const value = textarea.value;
  let start = textarea.selectionStart ?? 0;
  let end = textarea.selectionEnd ?? 0;
  while (start > 0 && value[start - 1] !== "\n") start -= 1;
  if (end > start && value[end - 1] === "\n") end -= 1;
  while (end < value.length && value[end] !== "\n") end += 1;

  const block = value.slice(start, end);
  const lines = block.split("\n").map((line) => {
    const match = line.match(LIST_LINE_RE);
    if (!match) return line;
    const [, indent, marker, space, rest] = match;
    if (direction > 0) {
      return LIST_INDENT_UNIT + indent + marker + space + rest;
    }
    if (indent.startsWith(LIST_INDENT_UNIT)) {
      return indent.slice(LIST_INDENT_UNIT.length) + marker + space + rest;
    }
    if (indent.length >= 2) {
      return indent.slice(2) + marker + space + rest;
    }
    return line;
  });

  const joined = lines.join("\n");
  textarea.value = value.slice(0, start) + joined + value.slice(end);
  textarea.setSelectionRange(start, start + joined.length);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Apply a formatting command in the contenteditable rendered pane. */
export function applyRenderedCommand(editable, command, value = null) {
  if (!editable) return;
  editable.focus();
  try {
    if (command === "createLink") {
      const url = value || window.prompt("Link URL", "https://");
      if (!url) return;
      document.execCommand("createLink", false, url);
    } else if (command === "formatBlock") {
      document.execCommand("formatBlock", false, value || "p");
    } else if (command === "insertHorizontalRule") {
      document.execCommand("insertHorizontalRule", false, null);
    } else if (command === "code") {
      wrapRenderedInline(editable, "code");
    } else {
      document.execCommand(command, false, value);
    }
  } catch {
    /* ignore unsupported commands */
  }
  editable.dispatchEvent(new Event("input", { bubbles: true }));
}

function wrapRenderedInline(editable, tagName) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return;
  const el = document.createElement(tagName);
  if (range.collapsed) {
    el.textContent = "code";
    range.insertNode(el);
    sel.selectAllChildren(el);
  } else {
    try {
      range.surroundContents(el);
    } catch {
      const text = range.toString() || "code";
      range.deleteContents();
      el.textContent = text;
      range.insertNode(el);
    }
  }
}

function collapseWs(text) {
  return String(text || "").replace(/\u00a0/g, " ");
}

/** Escape Markdown inline specials, but keep footnote markers intact. */
function escapeMdText(value) {
  const slots = [];
  let s = collapseWs(value);
  s = s.replace(/\[\^[^\]]+\]/g, (m) => {
    const key = `\uE010${slots.length}\uE011`;
    slots.push(m);
    return key;
  });
  s = s.replace(/([\\`*_[\]{}])/g, "\\$1");
  return s.replace(/\uE010(\d+)\uE011/g, (_, n) => slots[Number(n)] ?? "");
}

/** Undo accidental escapes like \[^1\] from older serializer rounds. */
export function repairEscapedFootnotes(markdown) {
  return String(markdown || "")
    .replace(/\\+\[(\^[^\]]+)\\+\]/g, "[$1]")
    .replace(/\\+\[(\^[^\]]+)\]/g, "[$1]")
    .replace(/\[\\+(\^[^\]]+)\\+\]/g, "[$1]")
    .replace(/\[\\+(\^[^\]]+)\]/g, "[$1]");
}

function footnoteIdFromEl(el) {
  if (!el) return "";
  const a = el.tagName?.toLowerCase() === "a" ? el : el.querySelector?.("a");
  const fromHref = a?.getAttribute("href")?.match(/^#fn-(.+)$/)?.[1];
  if (fromHref) return fromHref;
  const fromId =
    a?.getAttribute("id")?.replace(/^fnref-/, "") ||
    el.getAttribute?.("id")?.replace(/^fnref-/, "");
  if (fromId) return fromId;
  const text = (a || el).textContent || "";
  return text.replace(/[\[\]\s]/g, "").replace(/^\^/, "");
}

function imageSrcToMarkdown(src) {
  const raw = String(src || "").trim();
  if (!raw) return "";
  const name = raw.split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  if (/^page-\d+(?:-\d{3})?\.(jpe?g|png|webp|gif)$/i.test(name)) return name;
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
  return name || raw;
}

/** Per-line wrappers when inline formatting spans <br> inside a blockquote. */
const BLOCKQUOTE_LINE_WRAP = {
  em: (text) => `*${text}*`,
  i: (text) => `*${text}*`,
  strong: (text) => `**${text}**`,
  b: (text) => `**${text}**`,
  del: (text) => `~~${text}~~`,
  s: (text) => `~~${text}~~`,
  strike: (text) => `~~${text}~~`,
  u: (text) => `<u>${text}</u>`,
};

function splitElementOnBr(el) {
  const segments = [[]];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === "br") {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(child);
    }
  }
  return segments;
}

function pushBlockquoteLine(lines, text) {
  if (text === "" && lines.length > 0 && lines[lines.length - 1] === "") return;
  lines.push(text);
}

/** Blockquote lines with per-line inline markers (not one wrapper across multiple > lines). */
function serializeBlockquoteElement(el) {
  const lines = [];
  let parts = [];

  const flush = () => {
    const text = parts
      .map((part) => (typeof part === "string" ? part : serializeInline(part)))
      .join("");
    parts = [];
    pushBlockquoteLine(lines, text);
  };

  const appendSplitLines = (node, wrap) => {
    if (parts.length) flush();
    for (const segment of splitElementOnBr(node)) {
      if (!segment.length) {
        pushBlockquoteLine(lines, "");
        continue;
      }
      const text = segment.map((n) => serializeInline(n)).join("");
      pushBlockquoteLine(lines, text ? wrap(text) : "");
    }
  };

  const appendBlockLine = (node) => {
    if (parts.length) flush();
    const text = Array.from(node.childNodes).map((n) => serializeInline(n)).join("").trim();
    pushBlockquoteLine(lines, text);
  };

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue) parts.push(node);
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      flush();
    } else if (Object.prototype.hasOwnProperty.call(BLOCKQUOTE_LINE_WRAP, tag)) {
      appendSplitLines(node, BLOCKQUOTE_LINE_WRAP[tag]);
    } else if (tag === "p" || tag === "div") {
      appendBlockLine(node);
    } else {
      parts.push(node);
    }
  }
  flush();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function serializeInline(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMdText(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = /** @type {HTMLElement} */ (node);
  const tag = el.tagName.toLowerCase();
  const kids = () => Array.from(el.childNodes).map(serializeInline).join("");

  if (el.classList?.contains("md-fn-ref") || (tag === "sup" && el.querySelector("a[href^='#fn-']"))) {
    const id = footnoteIdFromEl(el);
    return id ? `[^${id}]` : kids();
  }
  if (el.classList?.contains("md-math-inline") || el.classList?.contains("md-math")) {
    const tex = el.textContent || "";
    if (el.classList.contains("md-math-block") || el.classList.contains("md-math-display")) {
      return `$$${tex}$$`;
    }
    return `$${tex}$`;
  }
  if (tag === "br") return "  \n";
  if (tag === "strong" || tag === "b") return `**${kids()}**`;
  if (tag === "em" || tag === "i") return `*${kids()}*`;
  if (tag === "del" || tag === "s" || tag === "strike") return `~~${kids()}~~`;
  if (tag === "u") return `<u>${kids()}</u>`;
  if (tag === "code") return "`" + (el.textContent || "").replace(/`/g, "\\`") + "`";
  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    if (/^#fn-/.test(href) || /^fnref-/.test(el.id || "")) {
      const id = footnoteIdFromEl(el);
      return id ? `[^${id}]` : "";
    }
    if (el.classList?.contains("md-fn-back")) return "";
    return `[${kids()}](${href})`;
  }
  if (tag === "img") {
    const alt = el.getAttribute("alt") || "";
    const src = imageSrcToMarkdown(el.getAttribute("src") || "");
    return `![${alt}](${src})`;
  }
  if (tag === "span" && el.classList?.contains("md-image")) {
    return kids();
  }
  return kids();
}

function serializeBlocks(root) {
  const lines = [];

  function pushBlank() {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  }

  function walk(node, listDepth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = collapseWs(node.nodeValue).trim();
      if (t) lines.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = /** @type {HTMLElement} */ (node);
    const tag = el.tagName.toLowerCase();

    if (tag === "script" || tag === "style") return;

    if (/^h[1-6]$/.test(tag)) {
      pushBlank();
      const level = Number(tag[1]);
      lines.push(`${"#".repeat(level)} ${Array.from(el.childNodes).map(serializeInline).join("").trim()}`);
      pushBlank();
      return;
    }
    if (tag === "p") {
      pushBlank();
      const text = Array.from(el.childNodes).map(serializeInline).join("").trim();
      if (text) lines.push(text);
      pushBlank();
      return;
    }
    if (tag === "blockquote") {
      pushBlank();
      for (const line of serializeBlockquoteElement(el)) {
        lines.push(line ? `> ${line}` : ">");
      }
      pushBlank();
      return;
    }
    if (tag === "pre") {
      pushBlank();
      const code = el.querySelector("code");
      const body = (code || el).textContent || "";
      lines.push("```");
      lines.push(body.replace(/\n$/, ""));
      lines.push("```");
      pushBlank();
      return;
    }
    if (tag === "hr") {
      pushBlank();
      lines.push("---");
      pushBlank();
      return;
    }
    if (tag === "ul" || tag === "ol") {
      if (listDepth === 0) pushBlank();
      const indent = LIST_INDENT_UNIT.repeat(Math.max(0, listDepth));
      let i = 1;
      for (const child of el.children) {
        if (child.tagName.toLowerCase() !== "li") continue;
        const bullet = tag === "ol" ? `${i}. ` : "- ";
        i += 1;
        const liText = Array.from(child.childNodes)
          .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && ["ul", "ol"].includes(n.tagName.toLowerCase())))
          .map(serializeInline)
          .join("")
          .trim();
        lines.push(indent + bullet + liText);
        for (const nested of child.children) {
          if (["ul", "ol"].includes(nested.tagName.toLowerCase())) {
            walk(nested, listDepth + 1);
          }
        }
      }
      if (listDepth === 0) pushBlank();
      return;
    }
    if (tag === "table" || el.classList?.contains("md-table-wrap")) {
      const table = tag === "table" ? el : el.querySelector("table");
      if (!table) return;
      pushBlank();
      const rows = Array.from(table.querySelectorAll("tr"));
      rows.forEach((row, idx) => {
        const cells = Array.from(row.children).map((c) =>
          Array.from(c.childNodes).map(serializeInline).join("").trim(),
        );
        lines.push(`| ${cells.join(" | ")} |`);
        if (idx === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      pushBlank();
      return;
    }
    if (el.classList?.contains("md-footnotes")) {
      pushBlank();
      for (const li of el.querySelectorAll("li")) {
        const idFromAttr = li.id?.replace(/^fn-/, "") || "";
        const idFromLabel =
          li.querySelector(".md-fn-id")?.textContent?.match(/\[\^([^\]]+)\]/)?.[1] || "";
        const id = idFromAttr || idFromLabel;
        const clone = li.cloneNode(true);
        clone.querySelector(".md-fn-id")?.remove();
        clone.querySelectorAll(".md-fn-back").forEach((n) => n.remove());
        const body = Array.from(clone.childNodes).map(serializeInline).join("").trim();
        if (id) lines.push(`[^${id}]: ${body}`);
      }
      pushBlank();
      return;
    }
    if (tag === "div" || tag === "section" || tag === "article") {
      for (const child of el.childNodes) walk(child, listDepth);
      return;
    }
    // Fallback: treat as inline paragraph-ish
    const inline = serializeInline(el).trim();
    if (inline) {
      pushBlank();
      lines.push(inline);
      pushBlank();
    }
  }

  for (const child of root.childNodes) walk(child);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Convert editor HTML (from renderMarkdown / contenteditable) back to Markdown. */
export function htmlToMarkdown(root) {
  if (!root) return "";
  return repairEscapedFootnotes(serializeBlocks(root));
}

export function nextFootnoteId(markdown) {
  let max = 0;
  for (const match of String(markdown || "").matchAll(/\[\^(\d+)\]/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return String(max + 1);
}

/** Marker temporarily dropped into the contenteditable to locate the caret in Markdown. */
export const FOOTNOTE_CARET_SENTINEL = "SCRIBEFOOTNOTEREF";

/**
 * Insert a footnote reference at `atIndex` (or replace a sentinel) and append a definition.
 * @returns {{ markdown: string, id: string }}
 */
export function applyFootnoteToMarkdown(markdown, atIndex = null) {
  let md = String(markdown || "");
  const sentinelAt = md.indexOf(FOOTNOTE_CARET_SENTINEL);
  const id = nextFootnoteId(md.replaceAll(FOOTNOTE_CARET_SENTINEL, ""));
  const marker = `[^${id}]`;

  if (sentinelAt >= 0) {
    md = md.replaceAll(FOOTNOTE_CARET_SENTINEL, marker);
  } else if (atIndex != null && Number.isFinite(atIndex)) {
    const i = Math.max(0, Math.min(md.length, atIndex));
    md = md.slice(0, i) + marker + md.slice(i);
  } else {
    md = `${md.replace(/\s*$/, "")}${marker}`;
  }

  // Drop any leftover sentinel copies
  md = md.replaceAll(FOOTNOTE_CARET_SENTINEL, "");

  const defLine = `[^${id}]: footnote`;
  if (!new RegExp(`\\[\\^${id}\\]:\\s`).test(md)) {
    md = `${md.replace(/\s*$/, "")}\n\n${defLine}\n`;
  }
  return { markdown: md, id };
}

function insertFootnoteInTextarea(textarea) {
  if (!textarea) return;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const { markdown, id } = applyFootnoteToMarkdown(textarea.value, end);
  textarea.value = markdown;
  const defLine = `[^${id}]: footnote`;
  const defAt = markdown.lastIndexOf(defLine);
  const placeholderStart = defAt + `[^${id}]: `.length;
  textarea.setSelectionRange(placeholderStart, placeholderStart + "footnote".length);
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Raw-mode toolbar action map. */
export function applyRawFormat(textarea, action) {
  switch (action) {
    case "bold":
      wrapTextareaSelection(textarea, "**", "**", "bold");
      break;
    case "italic":
      wrapTextareaSelection(textarea, "*", "*", "italic");
      break;
    case "strike":
      wrapTextareaSelection(textarea, "~~", "~~", "text");
      break;
    case "underline":
      wrapTextareaSelection(textarea, "<u>", "</u>", "text");
      break;
    case "code":
      wrapTextareaSelection(textarea, "`", "`", "code");
      break;
    case "link": {
      const url = window.prompt("Link URL", "https://");
      if (!url) return;
      wrapTextareaSelection(textarea, "[", `](${url})`, "link text");
      break;
    }
    case "h1":
      prefixTextareaLines(textarea, "# ");
      break;
    case "h2":
      prefixTextareaLines(textarea, "## ");
      break;
    case "h3":
      prefixTextareaLines(textarea, "### ");
      break;
    case "quote":
      prefixTextareaLines(textarea, "> ");
      break;
    case "ul":
      prefixTextareaLines(textarea, "- ");
      break;
    case "ol":
      prefixTextareaLines(textarea, "1. ");
      break;
    case "indent":
      indentTextareaListLines(textarea, 1);
      break;
    case "outdent":
      indentTextareaListLines(textarea, -1);
      break;
    case "footnote":
      insertFootnoteInTextarea(textarea);
      break;
    case "hr":
      insertTextareaSnippet(textarea, "\n\n---\n\n");
      break;
    default:
      break;
  }
}

/** Rendered-mode toolbar action map. */
export function applyRenderedFormat(editable, action) {
  switch (action) {
    case "bold":
      applyRenderedCommand(editable, "bold");
      break;
    case "italic":
      applyRenderedCommand(editable, "italic");
      break;
    case "strike":
      applyRenderedCommand(editable, "strikeThrough");
      break;
    case "underline":
      applyRenderedCommand(editable, "underline");
      break;
    case "code":
      applyRenderedCommand(editable, "code");
      break;
    case "link":
      applyRenderedCommand(editable, "createLink");
      break;
    case "h1":
      applyRenderedCommand(editable, "formatBlock", "h1");
      break;
    case "h2":
      applyRenderedCommand(editable, "formatBlock", "h2");
      break;
    case "h3":
      applyRenderedCommand(editable, "formatBlock", "h3");
      break;
    case "quote":
      applyRenderedCommand(editable, "formatBlock", "blockquote");
      break;
    case "ul":
      applyRenderedCommand(editable, "insertUnorderedList");
      break;
    case "ol":
      applyRenderedCommand(editable, "insertOrderedList");
      break;
    case "indent":
      applyRenderedCommand(editable, "indent");
      break;
    case "outdent":
      applyRenderedCommand(editable, "outdent");
      break;
    case "footnote":
      // Handled in app.js via Markdown draft + re-render (not plain text).
      break;
    case "hr":
      applyRenderedCommand(editable, "insertHorizontalRule");
      break;
    default:
      break;
  }
}
