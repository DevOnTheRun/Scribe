/**
 * Lightweight Markdown → HTML for Scribe Preview / Cleaning.
 * Escapes raw HTML (no HTML passthrough). Supports headings, lists, blockquotes,
 * tables, footnotes, strikethrough, underline, emphasis, links, images, code, and $ / $$ math
 * (shown as readable LaTeX source — not a full math engine).
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveSrc(src, resolveImageUrl) {
  const raw = String(src || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:|\/)/i.test(raw)) return raw;
  if (typeof resolveImageUrl === "function") {
    return resolveImageUrl(raw) || raw;
  }
  return raw;
}

/** Extract [^id]: definitions; return { body, footnotes: Map } */
function extractFootnotes(text) {
  const footnotes = new Map();
  const lines = text.split("\n");
  const body = [];
  let i = 0;
  while (i < lines.length) {
    const def = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (def) {
      const id = def[1];
      const parts = [def[2]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim()) break;
        if (/^\[\^[^\]]+\]:/.test(next)) break;
        if (/^(#{1,6}\s|```|\|)/.test(next)) break;
        // Continuation: indented or plain following lines until blank
        if (/^\s{2,}\S/.test(next) || (!/^\S/.test(next) && next.trim())) {
          parts.push(next.trim());
          i += 1;
          continue;
        }
        if (/^\S/.test(next) && !/^\[\^/.test(next)) {
          // Non-indented new paragraph — stop (GFM is stricter; keep simple)
          break;
        }
        break;
      }
      footnotes.set(id, parts.join(" ").trim());
      continue;
    }
    body.push(lines[i]);
    i += 1;
  }
  return { body: body.join("\n"), footnotes };
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s|:|-]*\|?\s*$/.test(line) && /\|/.test(line) && /-/.test(line);
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function parseAlignments(sepLine) {
  return splitTableRow(sepLine).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/**
 * Protect math and inline code with placeholders before escaping / emphasis.
 * @returns {{ text: string, restore: (s: string) => string }}
 */
function protectInlineSpecials(text) {
  const slots = [];
  const put = (html) => {
    const key = `\uE000${slots.length}\uE001`;
    slots.push(html);
    return key;
  };

  let s = text;
  // Block-ish $$...$$ first (may span; we only handle same-line here — block handled separately)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, body) =>
    put(`<span class="md-math md-math-display" title="LaTeX">${escapeHtml(body.trim())}</span>`),
  );
  // Inline $...$ (avoid empty / lone $)
  s = s.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (_, body) =>
    put(`<span class="md-math md-math-inline" title="LaTeX">${escapeHtml(body.trim())}</span>`),
  );
  // Inline code
  s = s.replace(/`([^`]+)`/g, (_, body) => put(`<code>${escapeHtml(body)}</code>`));
  // Underline (<u> — no CommonMark syntax; passes through to EPUB export)
  s = s.replace(/<u>([^<\n]*)<\/u>/gi, (_, body) => put(`<u>${escapeHtml(body)}</u>`));

  return {
    text: s,
    restore: (out) => out.replace(/\uE000(\d+)\uE001/g, (_, n) => slots[Number(n)] ?? ""),
  };
}

function inlineMarkdown(text, resolveImageUrl, footnotes) {
  const { text: protectedText, restore } = protectInlineSpecials(text);
  let s = escapeHtml(protectedText);

  // Footnote references [^id]
  s = s.replace(/\[\^([^\]]+)\]/g, (_, id) => {
    const safe = escapeHtml(id);
    const tip = footnotes?.has(id) ? escapeHtml(footnotes.get(id)) : "";
    return `<sup class="md-fn-ref"><a href="#fn-${safe}" id="fnref-${safe}" title="${tip}">[${safe}]</a></sup>`;
  });

  // Images ![alt](url) — before links
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => {
    const src = escapeHtml(resolveSrc(url, resolveImageUrl));
    const a = escapeHtml(alt);
    return `<img src="${src}" alt="${a}" loading="lazy" />`;
  });

  // Links [text](url) — in-app index targets stay in the pane
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
    const href = escapeHtml(url);
    if (/^#scribe-p\d+/i.test(String(url || "").trim())) {
      return `<a href="${href}" class="scribe-index-link">${label}</a>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Bold / italic (order matters)
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");

  return restore(s);
}

/** Repair inline markers split across blockquote lines (legacy round-trips). */
const BLOCKQUOTE_SPAN_REPAIRS = [
  {
    opens: (t) => /^<u>/i.test(t) && !/<\/u>/i.test(t),
    closes: (t) => /^<\/u>\s*$/i.test(t.trim()),
    stripOpen: (t) => t.replace(/^\s*<u>/i, ""),
    stripClose: (t) => t.replace(/\s*<\/u>\s*$/i, ""),
    wrap: (parts) => `<u>${parts.join("<br />")}</u>`,
  },
  {
    opens: (t) => t.startsWith("**") && !t.slice(2).includes("**"),
    closes: (t) => t.trim() === "**",
    stripOpen: (t) => t.replace(/^\s*\*\*/, ""),
    stripClose: (t) => t.replace(/\*\*\s*$/, ""),
    wrap: (parts) => `<strong>${parts.join("<br />")}</strong>`,
  },
  {
    opens: (t) => t.startsWith("~~") && !t.slice(2).includes("~~"),
    closes: (t) => t.trim() === "~~",
    stripOpen: (t) => t.replace(/^\s*~~/, ""),
    stripClose: (t) => t.replace(/~~\s*$/, ""),
    wrap: (parts) => `<del>${parts.join("<br />")}</del>`,
  },
  {
    opens: (t) => t.startsWith("*") && !t.startsWith("**") && t.slice(1).indexOf("*") === -1,
    closes: (t) => t.trim() === "*",
    stripOpen: (t) => t.replace(/^\s*\*/, ""),
    stripClose: (t) => t.replace(/\*\s*$/, ""),
    wrap: (parts) => `<em>${parts.join("<br />")}</em>`,
  },
];

function repairBlockquoteSpan(lines, start, rule, inline) {
  let end = -1;
  for (let j = lines.length - 1; j > start; j -= 1) {
    const t = lines[j].trim();
    if (rule.closes(t)) {
      end = j;
      break;
    }
    if (t !== "") break;
  }
  if (end <= start) return null;
  const parts = [];
  for (let j = start; j <= end; j += 1) {
    let t = lines[j];
    if (j === start) t = rule.stripOpen(t);
    else if (j === end) t = rule.stripClose(t);
    parts.push(inline(t));
  }
  return { html: rule.wrap(parts), next: end + 1 };
}

function renderBlockquoteParagraph(lines, inline) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    let repaired = null;
    for (const rule of BLOCKQUOTE_SPAN_REPAIRS) {
      if (rule.opens(trimmed)) {
        repaired = repairBlockquoteSpan(lines, i, rule, inline);
        break;
      }
    }
    if (repaired) {
      out.push(repaired.html);
      i = repaired.next;
      continue;
    }
    out.push(inline(lines[i]));
    i += 1;
  }
  return out.join("<br />");
}

function renderBlockquoteBody(lines, inline) {
  const paragraphs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) paragraphs.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current);
  return paragraphs.map((para) => renderBlockquoteParagraph(para, inline)).join("<br /><br />");
}

/**
 * @param {string} source
 * @param {{ resolveImageUrl?: (src: string) => string }} [options]
 * @returns {string} HTML
 */
export function renderMarkdown(source, options = {}) {
  const resolveImageUrl = options.resolveImageUrl;
  let text = String(source ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";

  const { body, footnotes } = extractFootnotes(text);
  const lines = body.split("\n");
  const html = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let listStack = []; // { type: "ul"|"ol", indent: number }
  let para = [];
  let quote = [];

  const inline = (line) => inlineMarkdown(line, resolveImageUrl, footnotes);

  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p>${para.map(inline).join("<br />")}</p>`);
    para = [];
  };

  /** Blank > lines separate paragraphs; consecutive > lines share one paragraph. */
  const renderBlockquoteBodyLocal = (quoteLines) => renderBlockquoteBody(quoteLines, inline);

  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${renderBlockquoteBodyLocal(quote)}</blockquote>`);
    quote = [];
  };

  const closeList = () => {
    while (listStack.length) {
      html.push("</li>");
      const closed = listStack.pop();
      html.push(closed.type === "ol" ? "</ol>" : "</ul>");
    }
  };

  const leadingIndent = (line) => {
    let n = 0;
    for (const ch of line) {
      if (ch === " ") n += 1;
      else if (ch === "\t") n += 4;
      else break;
    }
    return n;
  };

  const pushListItem = (indent, type, content) => {
    flushPara();
    flushQuote();

    while (listStack.length && listStack[listStack.length - 1].indent > indent) {
      html.push("</li>");
      const closed = listStack.pop();
      html.push(closed.type === "ol" ? "</ol>" : "</ul>");
    }

    const top = listStack[listStack.length - 1];
    if (top && top.indent === indent) {
      html.push("</li>");
      if (top.type !== type) {
        html.push(top.type === "ol" ? "</ol>" : "</ul>");
        listStack.pop();
        html.push(type === "ol" ? "<ol>" : "<ul>");
        listStack.push({ type, indent });
      }
      html.push(`<li>${inline(content)}`);
      return;
    }

    // Deeper nest, or first list
    html.push(type === "ol" ? "<ol>" : "<ul>");
    listStack.push({ type, indent });
    html.push(`<li>${inline(content)}`);
  };

  const tryParseTable = () => {
    if (i + 1 >= lines.length) return false;
    const headerLine = lines[i];
    const sepLine = lines[i + 1];
    if (!headerLine.includes("|") || !isTableSeparator(sepLine)) return false;

    flushPara();
    flushQuote();
    closeList();

    const headers = splitTableRow(headerLine);
    const aligns = parseAlignments(sepLine);
    i += 2;
    const rows = [];
    while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
      if (isTableSeparator(lines[i])) {
        i += 1;
        continue;
      }
      rows.push(splitTableRow(lines[i]));
      i += 1;
    }

    const th = headers
      .map((h, idx) => {
        const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
        return `<th${align}>${inline(h)}</th>`;
      })
      .join("");
    const trs = rows
      .map((row) => {
        const cells = headers
          .map((_, idx) => {
            const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
            return `<td${align}>${inline(row[idx] ?? "")}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    html.push(`<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
    return true;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (inCode) {
      if (/^```/.test(line)) {
        html.push(
          `<pre class="md-code"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
            codeLines.join("\n"),
          )}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      i += 1;
      continue;
    }

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      flushQuote();
      closeList();
      inCode = true;
      codeLang = fence[1] || "";
      codeLines = [];
      i += 1;
      continue;
    }

    // Display math on its own line(s): $$ ... $$
    if (/^\s*\$\$/.test(line)) {
      flushPara();
      flushQuote();
      closeList();
      let chunk = line.trim();
      if (/^\s*\$\$/.test(chunk) && /\$\$\s*$/.test(chunk) && chunk.length > 4) {
        const body = chunk.replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "").trim();
        html.push(`<div class="md-math md-math-block" title="LaTeX">${escapeHtml(body)}</div>`);
        i += 1;
        continue;
      }
      // Multi-line $$ ... $$
      const parts = [chunk.replace(/^\s*\$\$/, "")];
      i += 1;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) {
        parts.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        parts.push(lines[i].replace(/\$\$\s*$/, ""));
        i += 1;
      }
      html.push(
        `<div class="md-math md-math-block" title="LaTeX">${escapeHtml(parts.join("\n").trim())}</div>`,
      );
      continue;
    }

    if (tryParseTable()) continue;

    const onlyImage = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (onlyImage) {
      flushPara();
      flushQuote();
      closeList();
      const src = escapeHtml(resolveSrc(onlyImage[2], resolveImageUrl));
      const alt = escapeHtml(onlyImage[1]);
      html.push(`<p class="md-image"><img src="${src}" alt="${alt}" loading="lazy" /></p>`);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flushPara();
      flushQuote();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_]){3,}\s*$/.test(line)) {
      flushPara();
      flushQuote();
      closeList();
      html.push("<hr />");
      i += 1;
      continue;
    }

    const bq = line.match(/^\s{0,3}>\s?(.*)$/);
    if (bq) {
      flushPara();
      closeList();
      const bqContent = bq[1];
      if (bqContent.trim() === "" && quote.length && quote[quote.length - 1].trim() === "") {
        i += 1;
        continue;
      }
      quote.push(bqContent);
      i += 1;
      continue;
    }

    const ul = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ul) {
      pushListItem(leadingIndent(line), "ul", ul[2]);
      i += 1;
      continue;
    }

    const ol = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ol) {
      pushListItem(leadingIndent(line), "ol", ol[2]);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushQuote();
      closeList();
      i += 1;
      continue;
    }

    flushQuote();
    closeList();
    para.push(line);
    i += 1;
  }

  if (inCode) {
    html.push(`<pre class="md-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushPara();
  flushQuote();
  closeList();

  if (footnotes.size) {
    html.push(`<section class="md-footnotes"><h4 class="md-footnotes-title">Footnotes</h4><ol>`);
    for (const [id, note] of footnotes) {
      const safe = escapeHtml(id);
      html.push(
        `<li id="fn-${safe}"><span class="md-fn-id">[^${safe}]</span> ${inline(note)} <a href="#fnref-${safe}" class="md-fn-back">↩</a></li>`,
      );
    }
    html.push(`</ol></section>`);
  }

  return html.join("\n");
}
