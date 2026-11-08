import Lego from "./lego.js";
import {
  applyCleaning,
  applyIndex,
  assetImageUrl,
  cancelOcr,
  coverPreviewUrl,
  createProject,
  deleteProject,
  downloadEpub,
  extractPageImage,
  fetchCleaningAnalyze,
  fetchExportMetadata,
  lookupExportMetadata,
  saveExportMetadata,
  fetchIndex,
  fetchJob,
  fetchPageMarkdown,
  fetchPages,
  fetchProject,
  fetchProjectImages,
  fetchProjects,
  pageImageUrl,
  pagePreviewUrl,
  patchProject,
  previewCleaning,
  regionOcr,
  saveIndex,
  savePageMarkdown,
  scanIndex,
  startOcr,
  uploadCover,
  uploadSource,
} from "./api.js";
import {
  applyFootnoteToMarkdown,
  applyRawFormat,
  applyRenderedFormat,
  FOOTNOTE_CARET_SENTINEL,
  htmlToMarkdown,
  insertTextareaSnippet,
  repairEscapedFootnotes,
} from "./editor.js";
import { renderMarkdown } from "./markdown.js";
import { initSettings, isModelsReady, openSettings } from "./settings.js";

/** @type {{ project: any | null, pollTimer: any, savedProjects: any[], projectSortKey: string, projectSortDir: string, previewPage: number, processedSet: Set<number>, coverPreviewTimer: any, cleanPage: number, cleanView: "rendered" | "raw", cleanCandidates: any[], cleanPreviewTimer: any, cleanAnalyzed: boolean, editPage: number, editView: "rendered" | "raw", editDraft: string, editSaved: string, editDirty: boolean, editSaveTimer: any, editLoadToken: number }} */
const state = {
  project: null,
  pollTimer: null,
  savedProjects: [],
  projectSortKey: "updated",
  projectSortDir: "desc",
  previewPage: 1,
  processedSet: new Set(),
  coverPreviewTimer: null,
  cleanPage: 1,
  cleanView: "rendered",
  cleanCandidates: [],
  cleanPreviewTimer: null,
  cleanAnalyzed: false,
  editPage: 1,
  editView: "rendered",
  editDraft: "",
  editSaved: "",
  editDirty: false,
  editSaveTimer: null,
  editLoadToken: 0,
  regionMode: null, // "rescan" | "extract" | null
  regionNorm: null,
  regionDragging: false,
  regionOrigin: null,
  editCaret: null,
  /** True only after the user (or a tool) mutates the contenteditable — not after raw edits + toggle. */
  editMutatedInRendered: false,
  indexEntries: [],
  indexApplied: false,
  indexDirty: false,
  indexSaveTimer: null,
  exportMetaProjectId: null,
  exportMetaDirty: false,
  exportMetaSaveTimer: null,
  exportMetaLoading: false,
};

function $(id) {
  return document.getElementById(id);
}

function showNotice(section, message, type = "info") {
  const el = $(`${section}-notice`);
  if (!el) return;
  el.classList.remove("lego-style-bannererror", "lego-style-bannerwarning", "lego-style-bannerinfo");
  if (!message) {
    el.classList.add("lego-hidden");
    el.textContent = "";
    return;
  }
  const kind =
    type === "error"
      ? "lego-style-bannererror"
      : type === "status"
        ? "lego-style-bannerwarning"
        : "lego-style-bannerinfo";
  el.classList.add(kind);
  el.textContent = message;
  el.classList.remove("lego-hidden");
}

function clearNotices(...sections) {
  for (const section of sections.length ? sections : ["home", "doc", "ocr", "preview", "cleaning", "index", "edit", "export"]) {
    showNotice(section, "");
  }
}

function wireHomeTabs() {
  $("tab-new")?.addEventListener("click", () => {
    Lego.show("panel-new");
    $("tab-new").classList.add("lego-tab-active");
    $("tab-open").classList.remove("lego-tab-active");
  });
  $("tab-open")?.addEventListener("click", () => {
    Lego.show("panel-open");
    $("tab-open").classList.add("lego-tab-active");
    $("tab-new").classList.remove("lego-tab-active");
    void refreshProjectList();
  });
}

function sortProjects(list) {
  const key = state.projectSortKey;
  const dir = state.projectSortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let av = a[key] || "";
    let bv = b[key] || "";
    if (key === "name") {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

async function refreshProjectList() {
  try {
    state.savedProjects = await fetchProjects();
  } catch (err) {
    showNotice("home", err.message || String(err), "error");
    return;
  }
  const list = $("project-list");
  const empty = $("project-list-empty");
  if (!list) return;
  list.innerHTML = "";
  const sorted = sortProjects(state.savedProjects);
  empty?.classList.toggle("lego-hidden", sorted.length > 0);
  const repaired = sorted.filter((p) => typeof p.error === "string" && /rebuilt from the files/i.test(p.error));
  if (repaired.length) {
    const names = repaired.map((p) => p.name).join(", ");
    showNotice(
      "home",
      `Metadata was rebuilt for ${names}. Open the project and check the name, cover, and page range.`,
      "status",
    );
  }
  sorted.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = `project-row ${i % 2 ? "project-row-secondary" : "project-row-primary"}`;
    const pages =
      p.page_count != null
        ? `${p.pages_processed || 0}/${p.page_count} pages processed`
        : p.has_markdown
          ? "Pages ready"
          : "No OCR yet";
    const repair = p.error
      ? `<div class="project-row-repair">${escapeHtml(p.error)}</div>`
      : "";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="lego-style-muted project-row-meta">${escapeHtml(p.status)} · ${escapeHtml(pages)}</div>
        ${repair}
      </div>
      <div class="btn-row">
        <button type="button" class="lego-style-bttnmain" data-open="${p.id}">Open</button>
        <button type="button" class="lego-style-bttndanger" data-delete="${p.id}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function openProject(id) {
  clearNotices();
  try {
    state.project = await fetchProject(id);
  } catch (err) {
    showNotice("home", err.message || String(err), "error");
    return;
  }
  state.previewPage = 1;
  state.cleanPage = 1;
  state.editPage = 1;
  state.editDraft = "";
  state.editSaved = "";
  state.editDirty = false;
  state.editMutatedInRendered = false;
  state.cleanAnalyzed = false;
  state.cleanCandidates = [];
  state.indexEntries = [];
  state.indexApplied = false;
  state.indexDirty = false;
  if (state.indexSaveTimer) {
    clearTimeout(state.indexSaveTimer);
    state.indexSaveTimer = null;
  }
  state.exportMetaProjectId = null;
  state.exportMetaDirty = false;
  if (state.exportMetaSaveTimer) {
    clearTimeout(state.exportMetaSaveTimer);
    state.exportMetaSaveTimer = null;
  }
  hideExportLookupResults();
  for (const id of [
    "export-title",
    "export-authors",
    "export-publisher",
    "export-year",
    "export-isbn",
    "export-description",
    "export-rights",
  ]) {
    if ($(id)) $(id).value = "";
  }
  if ($("export-language")) $("export-language").value = "en";
  $("home-panel")?.classList.add("lego-hidden");
  $("project-view")?.classList.remove("lego-hidden");
  syncOcrFormFromProject();
  await refreshProcessedPages();
  renderProject();
  void refreshPreview();
  maybePollOcr();
}

async function closeProject() {
  await flushEditSave();
  await flushIndexSave();
  await flushExportMetaSave();
  stopPoll();
  state.project = null;
  state.exportMetaProjectId = null;
  state.processedSet = new Set();
  $("project-view")?.classList.add("lego-hidden");
  $("home-panel")?.classList.remove("lego-hidden");
  void refreshProjectList();
}

function syncOcrFormFromProject() {
  const p = state.project;
  if (!p) return;
  const total = p.page_count || 1;
  const start = p.last_start_page || 1;
  const end = p.last_end_page || total;
  if ($("ocr-start-page")) $("ocr-start-page").value = String(start);
  if ($("ocr-end-page")) {
    $("ocr-end-page").value = String(end);
    $("ocr-end-page").max = String(total);
  }
  if ($("ocr-start-page")) $("ocr-start-page").max = String(total);
  const mode = p.cover_mode || (p.cover_page != null ? "page" : "none");
  setCoverMode(mode, { syncOnly: true });
  if ($("ocr-cover-page")) {
    $("ocr-cover-page").value = String(p.cover_page != null ? p.cover_page : 1);
    $("ocr-cover-page").max = String(total);
  }
  if ($("ocr-cover-quality")) $("ocr-cover-quality").value = String(p.cover_jpeg_quality || 85);
  if ($("ocr-fade-threshold")) {
    const fade = Math.max(0, Math.min(100, Number(p.fade_threshold) || 0));
    $("ocr-fade-threshold").value = String(fade);
    updateFadeThresholdLabel(fade);
  }
  if ($("cover-upload-name")) {
    $("cover-upload-name").textContent = p.has_cover_upload
      ? "Cover image saved on this project."
      : "";
  }
  if ($("preview-page-num")) {
    $("preview-page-num").max = String(total);
    $("preview-page-num").value = String(state.previewPage);
  }
  void refreshCoverPreview();
}

function updateFadeThresholdLabel(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  const el = $("ocr-fade-threshold-val");
  const input = $("ocr-fade-threshold");
  if (el) el.textContent = n <= 0 ? "Off" : String(n);
  if (input) input.setAttribute("aria-valuenow", String(n));
}

function selectedCoverMode() {
  const checked = document.querySelector('input[name="cover-mode"]:checked');
  return checked?.value || "none";
}

function setCoverMode(mode, { syncOnly = false } = {}) {
  const radios = document.querySelectorAll('input[name="cover-mode"]');
  radios.forEach((el) => {
    el.checked = el.value === mode;
  });
  const showFields = mode === "page" || mode === "upload";
  $("cover-page-fields")?.classList.toggle("lego-hidden", !showFields);
  $("cover-upload-fields")?.classList.toggle("lego-hidden", mode !== "upload");
  $("cover-actions")?.classList.toggle("lego-hidden", mode === "none");
  if ($("ocr-cover-page-label")) {
    $("ocr-cover-page-label").textContent = mode === "upload" ? "Insert as page" : "Cover page";
  }
  if (!syncOnly) void refreshCoverPreview();
}

function scheduleCoverPreview() {
  if (state.coverPreviewTimer) clearTimeout(state.coverPreviewTimer);
  state.coverPreviewTimer = setTimeout(() => void refreshCoverPreview(), 250);
}

async function refreshCoverPreview() {
  const p = state.project;
  const img = $("cover-preview-img");
  const empty = $("cover-preview-empty");
  const btn = $("cover-preview-btn");
  if (!p || !img) return;

  const mode = selectedCoverMode();
  let quality = Number($("ocr-cover-quality")?.value || p.cover_jpeg_quality || 85);
  if (!Number.isFinite(quality)) quality = 85;
  quality = Math.max(1, Math.min(95, quality));

  let page = Number($("ocr-cover-page")?.value || p.cover_page || 1);
  if (!Number.isFinite(page) || page < 1) page = 1;

  const canShow =
    (mode === "page" && p.has_source) ||
    (mode === "upload" && (p.has_cover_upload || $("cover-file")?.files?.[0]));

  if (!canShow) {
    img.classList.add("lego-hidden");
    empty?.classList.remove("lego-hidden");
    if (empty) {
      empty.textContent =
        mode === "upload"
          ? "Save a cover image to preview JPEG quality."
          : "Choose a PDF cover page or upload an image to preview JPEG quality.";
    }
    if (btn) btn.disabled = true;
    return;
  }

  // Prefer newly chosen local file until it is saved.
  const localFile = mode === "upload" ? $("cover-file")?.files?.[0] : null;
  if (localFile) {
    const url = URL.createObjectURL(localFile);
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    img.classList.remove("lego-hidden");
    empty?.classList.add("lego-hidden");
    if (btn) btn.disabled = false;
    return;
  }

  if (mode === "page" || (mode === "upload" && p.has_cover_upload)) {
    img.src = coverPreviewUrl(p.id, {
      quality,
      mode,
      page: mode === "page" ? page : undefined,
      bust: Date.now(),
    });
    img.onerror = () => {
      img.classList.add("lego-hidden");
      empty?.classList.remove("lego-hidden");
      if (empty) empty.textContent = "Could not render cover preview.";
      if (btn) btn.disabled = true;
    };
    img.onload = () => {
      img.classList.remove("lego-hidden");
      empty?.classList.add("lego-hidden");
      if (btn) btn.disabled = false;
    };
  }
}

function openCoverLightbox() {
  const src = $("cover-preview-img")?.src;
  const box = $("cover-lightbox");
  const full = $("cover-lightbox-img");
  if (!src || !box || !full || $("cover-preview-btn")?.disabled) return;
  full.src = src;
  box.classList.remove("lego-hidden");
}

function closeCoverLightbox() {
  $("cover-lightbox")?.classList.add("lego-hidden");
}

function updateSectionGates() {
  const hasSource = Boolean(state.project?.has_source);
  $("ocr-locked")?.classList.toggle("lego-hidden", hasSource);
  $("ocr-body")?.classList.toggle("lego-hidden", !hasSource);
  $("processing-locked")?.classList.toggle("lego-hidden", hasSource);
  $("processing-body")?.classList.toggle("lego-hidden", !hasSource);
  $("ocr-section")?.classList.toggle("is-locked", !hasSource);
  $("processing-section")?.classList.toggle("is-locked", !hasSource);
}

async function refreshProcessedPages() {
  if (!state.project) return;
  try {
    const pages = await fetchPages(state.project.id);
    state.processedSet = new Set(pages.map((row) => row.page));
  } catch {
    state.processedSet = new Set(state.project.processed_pages || []);
  }
}

function renderProject() {
  const p = state.project;
  if (!p) return;
  updateSectionGates();
  $("project-name").textContent = p.name;
  const desc = $("project-desc-display");
  if (desc) {
    desc.textContent = p.description || "";
    desc.classList.toggle("lego-hidden", !p.description);
  }
  $("project-status").textContent = statusLabel(p);
  $("source-filename").textContent = p.source_filename || "No file uploaded";
  $("source-meta").textContent =
    p.page_count != null
      ? `${p.page_count} page${p.page_count === 1 ? "" : "s"} · ${p.pages_processed || state.processedSet.size || 0} processed`
      : "";

  const pageCountEl = $("ocr-page-count");
  if (pageCountEl) {
    if (p.has_source && p.page_count != null) {
      pageCountEl.textContent =
        p.page_count === 1
          ? "This source has 1 page."
          : `This source has ${p.page_count} pages — set your range within 1–${p.page_count}.`;
    } else {
      pageCountEl.textContent = "";
    }
  }

  const running = p.status === "ocr_running";
  if ($("ocr-btn")) $("ocr-btn").disabled = !p.has_source || running || !isModelsReady();
  $("ocr-cancel-btn")?.classList.toggle("lego-hidden", !running);
  if ($("ocr-cancel-btn")) $("ocr-cancel-btn").disabled = !running;
  // Only show the bar while a live job is running (not after interrupt / completion sticky state).
  $("ocr-progress-wrap")?.classList.toggle("lego-hidden", !running);

  const rangeStart = p.last_start_page || 1;
  const rangeEnd = p.last_end_page || p.page_count || rangeStart;
  const rangeLen = Math.max(1, rangeEnd - rangeStart + 1);
  let done = p.pages_done || 0;
  // A running job used to save 0 at the start of every page. Finished files
  // in the range are the count the bar should show until that job reports one.
  if (running && !done && state.processedSet.size) {
    done = 0;
    for (const pageNum of state.processedSet) {
      if (pageNum >= rangeStart && pageNum <= rangeEnd) done += 1;
    }
  }
  const pct = done ? Math.min(100, Math.round((done / rangeLen) * 100)) : running ? 5 : 0;
  const bar = $("ocr-progress-bar");
  if (bar) bar.style.width = running ? `${pct}%` : "0%";
  if ($("ocr-progress-label")) {
    $("ocr-progress-label").textContent = running
      ? `Processing ${done || 0} of ${rangeLen} in range`
      : "";
  }
  if (p._ocr_interrupted) {
    showNotice(
      "ocr",
      "Previous OCR job was interrupted and is no longer running. You can process pages again.",
      "status",
    );
    delete p._ocr_interrupted;
  } else if (p.error) {
    showNotice("ocr", p.error, "error");
  }
}

function statusLabel(p) {
  switch (p.status) {
    case "needs_source":
      return "Upload a PDF to begin";
    case "ready":
      return "Ready to process pages";
    case "ocr_running":
      return "OCR in progress…";
    case "ocr_done":
      return "Pages processed";
    case "error":
      return "Error — see notice below";
    default:
      return p.status || "";
  }
}

async function refreshPreview() {
  const p = state.project;
  const img = $("preview-source-img");
  const empty = $("preview-source-empty");
  const md = $("preview-markdown");
  const badge = $("preview-md-badge");
  const meta = $("preview-page-meta");
  if (!p) return;

  const total = p.page_count || 1;
  state.previewPage = Math.max(1, Math.min(state.previewPage, total));
  if ($("preview-page-num")) $("preview-page-num").value = String(state.previewPage);
  if (meta) {
    const done = state.processedSet.has(state.previewPage);
    meta.textContent = `of ${total}${done ? " · processed" : " · not processed yet"}`;
  }

  if (img && p.has_source) {
    empty?.classList.add("lego-hidden");
    img.classList.remove("lego-hidden");
    img.onload = () => {
      img.classList.remove("lego-hidden");
      empty?.classList.add("lego-hidden");
    };
    img.onerror = () => {
      img.classList.add("lego-hidden");
      empty?.classList.remove("lego-hidden");
      if (empty) empty.textContent = "Could not render this page.";
    };
    img.src = pagePreviewUrl(p.id, state.previewPage, { bust: Date.now() });
  } else {
    img?.classList.add("lego-hidden");
    empty?.classList.remove("lego-hidden");
  }

  if (!md) return;
  if (!state.processedSet.has(state.previewPage)) {
    md.classList.add("is-empty");
    md.textContent = "This page has not been processed yet. Run OCR on a range that includes it.";
    if (badge) badge.textContent = "";
    return;
  }
  try {
    const data = await fetchPageMarkdown(p.id, state.previewPage);
    const source = data.markdown || "";
    md.classList.remove("is-empty");
    md.innerHTML = renderMarkdown(source, {
      resolveImageUrl: (src) => resolvePreviewImageUrl(p.id, src, state.previewPage),
    });
    if (badge) badge.textContent = data.is_cover ? "(cover image)" : "";
  } catch (err) {
    md.classList.add("is-empty");
    md.textContent = err.message || String(err);
    if (badge) badge.textContent = "";
  }
}

/** Map relative Markdown image paths (e.g. page-0001.jpg / page-0001-001.jpg) to API URLs. */
function resolvePreviewImageUrl(projectId, src, fallbackPage) {
  const name = String(src || "").split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  const extract = name.match(/^page-(\d+)-(\d{3})\.(jpe?g|png|webp|gif)$/i);
  if (extract) {
    return assetImageUrl(projectId, name, { bust: Date.now() });
  }
  const match = name.match(/^page-(\d+)\.(jpe?g|png|webp|gif)$/i);
  if (match) {
    return pageImageUrl(projectId, Number(match[1]), { bust: Date.now() });
  }
  if (/^page-\d+/i.test(name) && /\.(jpe?g|png|webp|gif)$/i.test(name)) {
    return assetImageUrl(projectId, name, { bust: Date.now() });
  }
  if (/\.(jpe?g|png|webp|gif)$/i.test(name)) {
    return pageImageUrl(projectId, fallbackPage, { bust: Date.now() });
  }
  return src;
}

function firstProcessedPage() {
  const pages = [...state.processedSet].sort((a, b) => a - b);
  return pages[0] || 1;
}

function readCleanOptions() {
  const selected = [];
  document.querySelectorAll("#clean-candidates input[data-running]:checked").forEach((el) => {
    const text = el.getAttribute("data-running");
    if (text) selected.push(text);
  });
  return {
    remove_page_numbers: Boolean($("clean-opt-page-numbers")?.checked),
    remove_running_headers: Boolean($("clean-opt-running")?.checked),
    book_title: $("clean-header-pattern")?.value?.trim() || "",
    header_pattern: $("clean-header-pattern")?.value?.trim() || "",
    selected_running: selected,
    extra_phrases: [],
  };
}

function renderCleanCandidates(candidates) {
  const box = $("clean-candidates");
  if (!box) return;
  state.cleanCandidates = candidates || [];
  if (!state.cleanCandidates.length) {
    box.innerHTML = `<p class="lego-style-muted">No repeating headers found yet. Process more pages, or enter a header/footer pattern above.</p>`;
    return;
  }
  box.innerHTML = state.cleanCandidates
    .map((c, i) => {
      const label = escapeHtml(c.text);
      const meta = `${c.count} page${c.count === 1 ? "" : "s"}`;
      const value = escapeHtml(c.text);
      return `<label class="cleaning-candidate">
        <input type="checkbox" data-running="${value}" ${i === 0 ? "checked" : ""} />
        <span>${label}</span>
        <span class="cleaning-candidate-meta lego-style-muted">${escapeHtml(meta)}</span>
      </label>`;
    })
    .join("");
}

async function analyzeCleaning({ force = false } = {}) {
  if (!state.project?.has_source) return;
  if (state.cleanAnalyzed && !force) return;
  try {
    showNotice("cleaning", "Scanning pages for repeating headers…", "status");
    const data = await fetchCleaningAnalyze(state.project.id);
    renderCleanCandidates(data.candidates || []);
    if (data.suggested_title && $("clean-header-pattern") && !$("clean-header-pattern").value.trim()) {
      $("clean-header-pattern").value = data.suggested_title;
    }
    state.cleanAnalyzed = true;
    showNotice(
      "cleaning",
      data.page_count
        ? `Scanned ${data.page_count} pages — ${data.candidates?.length || 0} repeating header(s) found.`
        : "No processed pages to analyze yet.",
      "info",
    );
    scheduleCleanPreview();
  } catch (err) {
    showNotice("cleaning", err.message || String(err), "error");
  }
}

function setCleanView(mode) {
  state.cleanView = mode === "raw" ? "raw" : "rendered";
  $("clean-view-rendered")?.classList.toggle("is-active", state.cleanView === "rendered");
  $("clean-view-raw")?.classList.toggle("is-active", state.cleanView === "raw");
  $("clean-before")?.classList.toggle("markdown-raw", state.cleanView === "raw");
  $("clean-before")?.classList.toggle("markdown-rendered", state.cleanView === "rendered");
  $("clean-after")?.classList.toggle("markdown-raw", state.cleanView === "raw");
  $("clean-after")?.classList.toggle("markdown-rendered", state.cleanView === "rendered");
  // Re-paint current preview text held in dataset
  paintCleanPanes(
    $("clean-before")?.dataset?.source || "",
    $("clean-after")?.dataset?.source || "",
  );
}

function paintCleanPanes(before, after) {
  const beforeEl = $("clean-before");
  const afterEl = $("clean-after");
  if (!beforeEl || !afterEl) return;
  beforeEl.dataset.source = before ?? "";
  afterEl.dataset.source = after ?? "";
  const raw = state.cleanView === "raw";
  if (raw) {
    beforeEl.textContent = before || "";
    afterEl.textContent = after || "";
    beforeEl.classList.toggle("is-empty", !before);
    afterEl.classList.toggle("is-empty", !after);
    return;
  }
  const resolve = (src) =>
    state.project ? resolvePreviewImageUrl(state.project.id, src, state.cleanPage) : src;
  if (!before) {
    beforeEl.classList.add("is-empty");
    beforeEl.textContent = "No markdown for this page.";
  } else {
    beforeEl.classList.remove("is-empty");
    beforeEl.innerHTML = renderMarkdown(before, { resolveImageUrl: resolve });
  }
  if (!after && before) {
    // Intentionally blank after cleaning
    afterEl.classList.remove("is-empty");
    afterEl.innerHTML = `<p class="lego-style-muted">(empty page)</p>`;
  } else if (!after) {
    afterEl.classList.add("is-empty");
    afterEl.textContent = "";
  } else {
    afterEl.classList.remove("is-empty");
    afterEl.innerHTML = renderMarkdown(after, { resolveImageUrl: resolve });
  }
}

function scheduleCleanPreview() {
  if (state.cleanPreviewTimer) clearTimeout(state.cleanPreviewTimer);
  state.cleanPreviewTimer = setTimeout(() => void refreshCleanPreview(), 200);
}

async function refreshCleanPreview() {
  const p = state.project;
  const meta = $("clean-page-meta");
  const changeMeta = $("clean-change-meta");
  if (!p) return;

  const processed = [...state.processedSet].sort((a, b) => a - b);
  if (!processed.length) {
    if (meta) meta.textContent = "No processed pages yet";
    if (changeMeta) changeMeta.textContent = "";
    paintCleanPanes("", "");
    $("clean-before").textContent = "Process pages with OCR before cleaning.";
    $("clean-before")?.classList.add("is-empty");
    $("clean-after").textContent = "";
    $("clean-after")?.classList.add("is-empty");
    return;
  }

  if (!state.processedSet.has(state.cleanPage)) {
    state.cleanPage = processed.includes(state.cleanPage)
      ? state.cleanPage
      : processed.reduce((best, n) => (Math.abs(n - state.cleanPage) < Math.abs(best - state.cleanPage) ? n : best), processed[0]);
  }
  if ($("clean-page-num")) {
    $("clean-page-num").value = String(state.cleanPage);
    $("clean-page-num").max = String(p.page_count || state.cleanPage);
  }
  if (meta) {
    meta.textContent = `of ${p.page_count || "?"} · ${state.processedSet.has(state.cleanPage) ? "processed" : "not processed"}`;
  }

  if (!state.processedSet.has(state.cleanPage)) {
    paintCleanPanes("", "");
    if (changeMeta) changeMeta.textContent = "";
    return;
  }

  try {
    const data = await previewCleaning(p.id, state.cleanPage, readCleanOptions());
    paintCleanPanes(data.before || "", data.after || "");
    if (changeMeta) {
      const n = (data.removed || []).length;
      changeMeta.textContent = data.changed
        ? `Would remove ${n} line${n === 1 ? "" : "s"} on this page.`
        : "No changes on this page with current options.";
    }
  } catch (err) {
    paintCleanPanes("", "");
    if (changeMeta) changeMeta.textContent = "";
    showNotice("cleaning", err.message || String(err), "error");
  }
}

function setEditSaveStatus(text) {
  const el = $("edit-save-status");
  if (el) el.textContent = text || "";
}

function syncEditDraftFromDom({ force = false } = {}) {
  if (state.editView === "raw") {
    state.editDraft = $("edit-md-raw")?.value ?? state.editDraft;
    return;
  }
  // Only round-trip HTML→MD when the contenteditable was actually changed.
  // Otherwise we keep the Markdown draft (e.g. raw footnote insert → toggle).
  if (!force && !state.editMutatedInRendered) return;
  const rendered = $("edit-md-rendered");
  if (rendered && !rendered.classList.contains("is-empty") && rendered.isContentEditable) {
    state.editDraft = repairEscapedFootnotes(htmlToMarkdown(rendered));
  }
}

function paintEditEditor() {
  const raw = $("edit-md-raw");
  const rendered = $("edit-md-rendered");
  if (!raw || !rendered) return;

  const showRaw = state.editView === "raw";
  raw.classList.toggle("lego-hidden", !showRaw);
  rendered.classList.toggle("lego-hidden", showRaw);
  const viewToggle = $("edit-view-toggle");
  viewToggle?.classList.toggle("is-active", showRaw);
  viewToggle?.setAttribute("aria-pressed", showRaw ? "true" : "false");
  viewToggle?.setAttribute("title", showRaw ? "Show rendered Markdown" : "Show raw Markdown");
  viewToggle?.setAttribute("aria-label", showRaw ? "Show rendered Markdown" : "Show raw Markdown");

  if (!state.processedSet.has(state.editPage)) {
    raw.value = "";
    raw.disabled = true;
    rendered.contentEditable = "false";
    rendered.classList.add("is-empty");
    rendered.textContent = "This page has not been processed yet. Run OCR on a range that includes it.";
    return;
  }

  raw.disabled = false;
  rendered.contentEditable = "true";
  rendered.classList.remove("is-empty");

  if (showRaw) {
    raw.value = state.editDraft;
  } else {
    const p = state.project;
    rendered.innerHTML = renderMarkdown(state.editDraft || "", {
      resolveImageUrl: (src) => (p ? resolvePreviewImageUrl(p.id, src, state.editPage) : src),
    });
  }
}

function setEditView(mode) {
  const next = mode === "raw" ? "raw" : "rendered";
  if (next === state.editView) return;
  if (state.editView === "raw") {
    syncEditDraftFromDom();
  } else if (state.editMutatedInRendered) {
    syncEditDraftFromDom({ force: true });
  }
  state.editMutatedInRendered = false;
  state.editView = next;
  paintEditEditor();
}

function scheduleEditSave() {
  if (!state.editDirty) {
    setEditSaveStatus(state.editSaved ? "Saved" : "");
    return;
  }
  setEditSaveStatus("Saving…");
  if (state.editSaveTimer) clearTimeout(state.editSaveTimer);
  state.editSaveTimer = setTimeout(() => void flushEditSave(), 700);
}

async function flushEditSave() {
  if (state.editSaveTimer) {
    clearTimeout(state.editSaveTimer);
    state.editSaveTimer = null;
  }
  if (state.editView === "raw") {
    syncEditDraftFromDom();
  } else if (state.editMutatedInRendered) {
    syncEditDraftFromDom({ force: true });
  }
  const p = state.project;
  if (!p || !state.editDirty) {
    if (state.editSaved) setEditSaveStatus("Saved");
    return;
  }
  if (!state.processedSet.has(state.editPage)) return;
  if (state.editDraft === state.editSaved) {
    state.editDirty = false;
    setEditSaveStatus("Saved");
    return;
  }
  const page = state.editPage;
  const markdown = state.editDraft;
  const token = state.editLoadToken;
  try {
    setEditSaveStatus("Saving…");
    const result = await savePageMarkdown(p.id, page, markdown);
    if (token !== state.editLoadToken || page !== state.editPage) return;
    state.editSaved = markdown;
    state.editDirty = false;
    if (result.project) state.project = result.project;
    setEditSaveStatus("Saved");
    if (state.previewPage === page) void refreshPreview();
  } catch (err) {
    setEditSaveStatus("Save failed");
    showNotice("edit", err.message || String(err), "error");
  }
}

async function goToEditPage(page) {
  await flushEditSave();
  state.editPage = page;
  await refreshEdit();
}

async function refreshEdit() {
  const p = state.project;
  const img = $("edit-source-img");
  const empty = $("edit-source-empty");
  const badge = $("edit-md-badge");
  const meta = $("edit-page-meta");
  if (!p) return;

  const total = p.page_count || 1;
  state.editPage = Math.max(1, Math.min(state.editPage, total));
  if ($("edit-page-num")) {
    $("edit-page-num").value = String(state.editPage);
    $("edit-page-num").max = String(total);
  }
  if (meta) {
    const done = state.processedSet.has(state.editPage);
    meta.textContent = `of ${total}${done ? " · processed" : " · not processed yet"}`;
  }

  if (img && p.has_source) {
    empty?.classList.add("lego-hidden");
    img.classList.remove("lego-hidden");
    img.onload = () => {
      img.classList.remove("lego-hidden");
      empty?.classList.add("lego-hidden");
    };
    img.onerror = () => {
      img.classList.add("lego-hidden");
      empty?.classList.remove("lego-hidden");
      if (empty) empty.textContent = "Could not render this page.";
    };
    img.src = pagePreviewUrl(p.id, state.editPage, { bust: Date.now() });
  } else {
    img?.classList.add("lego-hidden");
    empty?.classList.remove("lego-hidden");
  }

  const token = ++state.editLoadToken;
  if (!state.processedSet.has(state.editPage)) {
    state.editDraft = "";
    state.editSaved = "";
    state.editDirty = false;
    state.editMutatedInRendered = false;
    setEditSaveStatus("");
    if (badge) badge.textContent = "";
    paintEditEditor();
    return;
  }

  try {
    const data = await fetchPageMarkdown(p.id, state.editPage);
    if (token !== state.editLoadToken) return;
    state.editDraft = repairEscapedFootnotes(data.markdown || "");
    state.editSaved = state.editDraft;
    state.editDirty = false;
    state.editMutatedInRendered = false;
    setEditSaveStatus("Saved");
    if (badge) badge.textContent = data.is_cover ? "(cover image)" : "";
    showNotice("edit", "");
    paintEditEditor();
  } catch (err) {
    if (token !== state.editLoadToken) return;
    state.editDraft = "";
    state.editSaved = "";
    state.editDirty = false;
    state.editMutatedInRendered = false;
    setEditSaveStatus("");
    if (badge) badge.textContent = "";
    paintEditEditor();
    showNotice("edit", err.message || String(err), "error");
  }
}

function onEditInput() {
  showNotice("edit", "");
  if (state.editView === "rendered") state.editMutatedInRendered = true;
  state.editDirty = true;
  scheduleEditSave();
}

/**
 * Insert a real Markdown footnote at the caret, then re-render so it becomes a
 * superscript + footnotes list — never leave raw [^n] as plain contenteditable text.
 */
function insertFootnoteInRenderedViaMarkdown() {
  const editable = $("edit-md-rendered");
  if (!editable || !editable.isContentEditable || editable.classList.contains("is-empty")) {
    return;
  }
  editable.focus();
  // Restore caret if we saved it for toolbar clicks
  const sel = window.getSelection();
  if (state.editCaret?.mode === "rendered" && state.editCaret.range && sel) {
    try {
      if (editable.contains(state.editCaret.range.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(state.editCaret.range.cloneRange());
      }
    } catch {
      /* ignore stale range */
    }
  }
  try {
    document.execCommand("insertText", false, FOOTNOTE_CARET_SENTINEL);
  } catch {
    /* ignore */
  }
  state.editMutatedInRendered = true;
  syncEditDraftFromDom({ force: true });
  const { markdown } = applyFootnoteToMarkdown(repairEscapedFootnotes(state.editDraft));
  state.editDraft = markdown;
  state.editDirty = true;
  // Draft is now authoritative Markdown; don't re-serialize this paint on toggle/save
  state.editMutatedInRendered = false;
  paintEditEditor();
  scheduleEditSave();
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** Map a client point to normalized 0–1 coords on an object-fit:contain image. */
function clientToImageNorm(img, clientX, clientY) {
  const rect = img.getBoundingClientRect();
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const scale = Math.min(rect.width / natW, rect.height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;
  const offsetX = rect.left + (rect.width - dispW) / 2;
  const offsetY = rect.top + (rect.height - dispH) / 2;
  return {
    x: clamp01((clientX - offsetX) / dispW),
    y: clamp01((clientY - offsetY) / dispH),
  };
}

function imageDisplayRect(img) {
  const rect = img.getBoundingClientRect();
  const stage = $("region-stage")?.getBoundingClientRect();
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const scale = Math.min(rect.width / natW, rect.height / natH);
  const dispW = natW * scale;
  const dispH = natH * scale;
  const left = rect.left - (stage?.left || rect.left) + (rect.width - dispW) / 2;
  const top = rect.top - (stage?.top || rect.top) + (rect.height - dispH) / 2;
  return { left, top, width: dispW, height: dispH };
}

function paintRegionSelection(norm) {
  const sel = $("region-sel");
  const img = $("region-lightbox-img");
  const confirm = $("region-lightbox-confirm");
  if (!sel || !img) return;
  if (!norm || norm.width <= 0 || norm.height <= 0) {
    sel.classList.add("lego-hidden");
    if (confirm) confirm.disabled = true;
    return;
  }
  const box = imageDisplayRect(img);
  sel.classList.remove("lego-hidden");
  sel.style.left = `${box.left + norm.x * box.width}px`;
  sel.style.top = `${box.top + norm.y * box.height}px`;
  sel.style.width = `${norm.width * box.width}px`;
  sel.style.height = `${norm.height * box.height}px`;
  if (confirm) confirm.disabled = false;
}

function closeRegionLightbox() {
  const box = $("region-lightbox");
  box?.classList.add("lego-hidden");
  box?.classList.remove("is-busy");
  state.regionMode = null;
  state.regionNorm = null;
  state.regionDragging = false;
  state.regionOrigin = null;
  paintRegionSelection(null);
  if ($("region-lightbox-status")) $("region-lightbox-status").textContent = "";
  if ($("region-lightbox-confirm")) $("region-lightbox-confirm").disabled = true;
}

function openRegionLightbox(mode) {
  const p = state.project;
  if (!p?.has_source) {
    showNotice("edit", "Save a source PDF before using this tool.", "error");
    return;
  }
  const box = $("region-lightbox");
  const img = $("region-lightbox-img");
  const title = $("region-lightbox-title");
  const hint = $("region-lightbox-hint");
  if (!box || !img) return;

  state.regionMode = mode === "extract" ? "extract" : "rescan";
  state.regionNorm = null;
  state.regionDragging = false;
  state.regionOrigin = null;
  paintRegionSelection(null);

  if (title) {
    title.textContent = state.regionMode === "extract" ? "Extract Image" : "Re-Scan";
  }
  if (hint) {
    hint.textContent =
      state.regionMode === "extract"
        ? "Click and drag to select the region to save as an image, then Confirm."
        : "Click and drag to select the region to re-OCR. Confirm replaces this page’s Markdown.";
  }
  if ($("region-lightbox-status")) $("region-lightbox-status").textContent = `Page ${state.editPage}`;
  if ($("region-lightbox-confirm")) {
    $("region-lightbox-confirm").disabled = true;
    $("region-lightbox-confirm").textContent = "Confirm";
  }

  img.onload = () => paintRegionSelection(state.regionNorm);
  img.src = pagePreviewUrl(p.id, state.editPage, { bust: Date.now() });
  box.classList.remove("lego-hidden");
}

async function confirmRegionSelection() {
  const p = state.project;
  const norm = state.regionNorm;
  if (!p || !norm || !state.regionMode) return;
  if (norm.width < 0.005 || norm.height < 0.005) {
    showNotice("edit", "Selection is too small — drag a larger region.", "error");
    return;
  }

  const box = $("region-lightbox");
  const confirm = $("region-lightbox-confirm");
  const status = $("region-lightbox-status");
  box?.classList.add("is-busy");
  if (confirm) confirm.disabled = true;
  const region = {
    x: norm.x,
    y: norm.y,
    width: norm.width,
    height: norm.height,
  };

  try {
    if (state.regionMode === "extract") {
      if (status) status.textContent = "Extracting…";
      const result = await extractPageImage(p.id, state.editPage, region);
      if (result.project) state.project = result.project;
      closeRegionLightbox();
      showNotice("edit", `Saved ${result.filename}. Use Insert image to place it in the Markdown.`, "info");
    } else {
      if (status) status.textContent = "Starting the OCR engine…";
      await flushEditSave();
      const result = await regionOcr(p.id, state.editPage, region);
      if (result.project) state.project = result.project;
      closeRegionLightbox();
      state.editDraft = result.markdown || "";
      state.editSaved = state.editDraft;
      state.editDirty = false;
      setEditSaveStatus("Saved");
      paintEditEditor();
      if (state.previewPage === state.editPage) void refreshPreview();
      showNotice("edit", "Page Markdown replaced with the re-scanned region.", "info");
    }
  } catch (err) {
    box?.classList.remove("is-busy");
    if (confirm) confirm.disabled = false;
    if (status) status.textContent = `Page ${state.editPage}`;
    if (err?.code === "vllm_unavailable" && state.regionMode !== "extract") {
      showVllmFailure(vllmFailureText(err), {
        kind: "region",
        page: state.editPage,
        region,
      });
      return;
    }
    showNotice("edit", err.message || String(err), "error");
  }
}

function closeInsertImageModal() {
  $("insert-image-modal")?.classList.add("lego-hidden");
}

/** Snapshot caret/selection before focus leaves the editor (e.g. Insert image modal). */
function saveEditCaret() {
  if (state.editView === "raw") {
    const ta = $("edit-md-raw");
    state.editCaret = ta
      ? { mode: "raw", start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 }
      : null;
    return;
  }
  const editable = $("edit-md-rendered");
  const sel = window.getSelection();
  if (!editable || !sel || !sel.rangeCount) {
    state.editCaret = { mode: "rendered", range: null };
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) {
    state.editCaret = { mode: "rendered", range: null };
    return;
  }
  state.editCaret = { mode: "rendered", range: range.cloneRange() };
}

function findEditableBlock(editable, node) {
  let el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== editable) {
    if (el.parentElement === editable) return el;
    el = el.parentElement;
  }
  return null;
}

/** Insert a block image at the saved rendered selection (splits the current block). */
function insertImageAtRenderedSelection(filename) {
  const editable = $("edit-md-rendered");
  const project = state.project;
  if (!editable || !editable.isContentEditable || editable.classList.contains("is-empty")) {
    return false;
  }

  const block = document.createElement("p");
  block.className = "md-image";
  const img = document.createElement("img");
  img.src = project ? assetImageUrl(project.id, filename, { bust: Date.now() }) : filename;
  img.alt = "Image";
  img.loading = "lazy";
  block.appendChild(img);

  const after = document.createElement("p");
  after.appendChild(document.createElement("br"));

  const sel = window.getSelection();
  let range =
    state.editCaret?.mode === "rendered" && state.editCaret.range
      ? state.editCaret.range.cloneRange()
      : null;
  if (range && !editable.contains(range.commonAncestorContainer)) range = null;

  if (!range) {
    editable.appendChild(block);
    editable.appendChild(after);
  } else {
    const host = findEditableBlock(editable, range.startContainer);
    if (host && host !== editable) {
      const tailRange = document.createRange();
      tailRange.selectNodeContents(host);
      tailRange.setStart(range.startContainer, range.startOffset);
      const tail = tailRange.extractContents();
      const hasTail = Boolean(tail.textContent?.replace(/\u200b/g, "").trim()) ||
        Boolean(tail.querySelector?.("img, br, *"));

      if (!host.textContent?.replace(/\u200b/g, "").trim() && !host.querySelector("img")) {
        host.innerHTML = "<br>";
      }

      host.after(block);

      const tailP = document.createElement("p");
      if (hasTail) {
        tailP.appendChild(tail);
      } else {
        tailP.appendChild(document.createElement("br"));
      }
      block.after(tailP);
    } else {
      range.deleteContents();
      range.insertNode(after);
      range.insertNode(block);
    }
  }

  const caretHost = block.nextElementSibling || after;
  if (caretHost && sel) {
    const caretRange = document.createRange();
    caretRange.setStart(caretHost, 0);
    caretRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caretRange);
  }
  editable.focus();
  return true;
}

async function openInsertImageModal() {
  const p = state.project;
  if (!p) return;
  const modal = $("insert-image-modal");
  const grid = $("insert-image-grid");
  const empty = $("insert-image-empty");
  if (!modal || !grid) return;
  grid.innerHTML = "";
  try {
    const data = await fetchProjectImages(p.id);
    const images = data.images || [];
    if (empty) empty.classList.toggle("lego-hidden", images.length > 0);
    for (const row of images) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "insert-image-card";
      btn.dataset.filename = row.filename;
      btn.innerHTML = `<img src="${assetImageUrl(p.id, row.filename, { bust: Date.now() })}" alt="" /><span>${escapeHtml(row.filename)}</span>`;
      grid.appendChild(btn);
    }
    modal.classList.remove("lego-hidden");
  } catch (err) {
    showNotice("edit", err.message || String(err), "error");
  }
}

function insertImageMarkdown(filename) {
  const name = String(filename || "").trim();
  if (!name) return;
  const snippet = `![Image](${name})\n\n`;

  if (state.editView === "raw") {
    const ta = $("edit-md-raw");
    if (ta && state.editCaret?.mode === "raw") {
      ta.focus();
      ta.setSelectionRange(state.editCaret.start, state.editCaret.end);
    }
    insertTextareaSnippet(ta, snippet);
  } else if (!insertImageAtRenderedSelection(name)) {
    syncEditDraftFromDom({ force: state.editDirty });
    const base = (state.editDraft || "").replace(/\s*$/, "");
    state.editDraft = base ? `${base}\n\n${snippet}` : snippet;
    paintEditEditor();
  }

  onEditInput();
  closeInsertImageModal();
  showNotice("edit", `Inserted ${name}.`, "info");
}

function slugifyHeading(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function parseScribeHref(href) {
  const match = String(href || "")
    .trim()
    .match(/^#scribe-p(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)$/i);
  if (!match) return null;
  return { page: Number(match[1]), anchor: match[2].toLowerCase() };
}

function activateProcTab(panelId) {
  Lego.show(panelId);
}

function collectIndexPayload() {
  const startRaw = $("index-replace-start")?.value;
  const endRaw = $("index-replace-end")?.value;
  const replace_start = startRaw ? Number(startRaw) : null;
  let replace_end = endRaw ? Number(endRaw) : null;
  if (replace_start != null && (replace_end == null || Number.isNaN(replace_end))) {
    replace_end = replace_start;
  }
  const entries = state.indexEntries.map((row) => ({ ...row }));
  entries.sort(compareIndexEntries);
  return {
    title: $("index-title")?.value?.trim() || "Contents",
    replace_start: Number.isFinite(replace_start) ? replace_start : null,
    replace_end: Number.isFinite(replace_end) ? replace_end : null,
    entries,
  };
}

function sortIndexEntries() {
  state.indexEntries.sort((a, b) => compareIndexEntries(a, b));
}

function compareIndexEntries(a, b) {
  const pa = Number(a.page) || 0;
  const pb = Number(b.page) || 0;
  if (pa !== pb) return pa - pb;
  const la = Number(a.level) || 1;
  const lb = Number(b.level) || 1;
  if (la !== lb) return la - lb;
  return String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" });
}

function setIndexSaveStatus(text) {
  const el = $("index-save-status");
  if (el) el.textContent = text || "";
}

function scheduleIndexSave() {
  state.indexDirty = true;
  setIndexSaveStatus("Saving…");
  if (state.indexSaveTimer) clearTimeout(state.indexSaveTimer);
  state.indexSaveTimer = setTimeout(() => void flushIndexSave(), 700);
}

async function flushIndexSave() {
  if (state.indexSaveTimer) {
    clearTimeout(state.indexSaveTimer);
    state.indexSaveTimer = null;
  }
  const p = state.project;
  if (!p || !state.indexDirty) {
    if (!state.indexDirty) setIndexSaveStatus(state.indexEntries.length ? "Saved" : "");
    return;
  }
  document.querySelectorAll(".index-entry").forEach((row) => syncIndexEntryFromDom(row));
  try {
    const index = await saveIndex(p.id, collectIndexPayload());
    state.indexDirty = false;
    state.indexApplied = Boolean(index.applied);
    // Keep local edits; refresh preview markdown from server
    if (index?.markdown) {
      const preview = $("index-preview");
      if (preview) {
        preview.innerHTML = renderMarkdown(index.markdown, {
          resolveImageUrl: (src) => resolvePreviewImageUrl(p.id, src, 1),
        });
      }
    }
    setIndexSaveStatus("Saved");
    paintIndexMeta();
  } catch (err) {
    setIndexSaveStatus("Error");
    showNotice("index", err.message || String(err), "error");
  }
}

function paintIndexMeta() {
  const meta = $("index-meta");
  if (!meta) return;
  const enabled = state.indexEntries.filter((e) => e.enabled !== false).length;
  const bits = [`${enabled} linked`];
  if (state.indexApplied) bits.push("applied to pages");
  meta.textContent = bits.join(" · ");
}

function applyIndexState(index) {
  if (!index) return;
  if ($("index-title")) $("index-title").value = index.title || "Contents";
  if ($("index-replace-start")) {
    $("index-replace-start").value = index.replace_start != null ? String(index.replace_start) : "";
  }
  if ($("index-replace-end")) {
    $("index-replace-end").value = index.replace_end != null ? String(index.replace_end) : "";
  }
  state.indexEntries = Array.isArray(index.entries) ? index.entries.map((e) => ({ ...e })) : [];
  state.indexApplied = Boolean(index.applied);
  state.indexDirty = false;
  setIndexSaveStatus(state.indexEntries.length ? "Saved" : "");
  paintIndexUi(index);
}

function paintIndexUi(index) {
  sortIndexEntries();
  const list = $("index-entries");
  if (list) {
    if (!state.indexEntries.length) {
      list.innerHTML = `<p class="lego-style-muted">No entries yet. Scan titles or add one manually.</p>`;
    } else {
      list.innerHTML = state.indexEntries
        .map((entry, i) => {
          const level = Math.max(1, Math.min(3, Number(entry.level) || 1));
          return `<div class="index-entry" data-index="${i}" role="listitem" style="padding-left:${(level - 1) * 14}px">
            <label class="index-entry-enable" title="Include in Contents">
              <input type="checkbox" data-index-field="enabled" ${entry.enabled !== false ? "checked" : ""} />
            </label>
            <input class="lego-style-input index-entry-label" type="text" data-index-field="label" value="${escapeHtml(entry.label || "")}" />
            <input class="lego-style-input index-entry-page" type="number" min="1" data-index-field="page" value="${Number(entry.page) || 1}" title="Target page" />
            <button type="button" class="lego-style-bttnsmall index-entry-outdent" data-index-outdent="${i}" title="Outdent" aria-label="Outdent" ${level <= 1 ? "disabled" : ""}>⇤</button>
            <button type="button" class="lego-style-bttnsmall index-entry-indent" data-index-indent="${i}" title="Indent" aria-label="Indent" ${level >= 3 ? "disabled" : ""}>⇥</button>
            <button type="button" class="lego-style-bttnsmall index-entry-goto" data-index-goto="${i}" title="Open in Edit">→</button>
            <button type="button" class="lego-style-bttnsmall index-entry-remove" data-index-remove="${i}" title="Remove">×</button>
          </div>`;
        })
        .join("");
    }
  }

  const preview = $("index-preview");
  if (preview) {
    const md = index?.markdown || localIndexMarkdown();
    preview.innerHTML = renderMarkdown(md, {
      resolveImageUrl: (src) => (state.project ? resolvePreviewImageUrl(state.project.id, src, 1) : src),
    });
  }

  paintIndexMeta();
}

function syncIndexEntryFromDom(row) {
  if (!row) return;
  const i = Number(row.getAttribute("data-index"));
  if (!Number.isFinite(i) || !state.indexEntries[i]) return;
  const entry = state.indexEntries[i];
  const enabled = row.querySelector('[data-index-field="enabled"]');
  const label = row.querySelector('[data-index-field="label"]');
  const page = row.querySelector('[data-index-field="page"]');
  if (enabled) entry.enabled = enabled.checked;
  if (label) entry.label = label.value;
  if (page) entry.page = Math.max(1, Number(page.value) || 1);
  entry.level = Math.max(1, Math.min(3, Number(entry.level) || 1));
  if (entry.label) {
    entry.anchor = slugifyHeading(entry.label) || entry.anchor || "section";
  }
  entry.source = entry.source || "manual";
}

function bumpIndexLevel(index, delta) {
  document.querySelectorAll(".index-entry").forEach((row) => syncIndexEntryFromDom(row));
  const entry = state.indexEntries[index];
  if (!entry) return;
  entry.level = Math.max(1, Math.min(3, (Number(entry.level) || 1) + delta));
  refreshIndexPreviewLocal();
  scheduleIndexSave();
}

function localIndexMarkdown() {
  const title = $("index-title")?.value?.trim() || "Contents";
  const lines = [`# ${title}`, ""];
  const active = state.indexEntries
    .filter((e) => e.enabled !== false)
    .slice()
    .sort(compareIndexEntries);
  if (!active.length) {
    lines.push("_No index entries yet. Scan titles or add links manually._", "");
    return lines.join("\n");
  }
  for (const entry of active) {
    const indent = "    ".repeat(Math.max(0, (Number(entry.level) || 1) - 1));
    const anchor = entry.anchor || slugifyHeading(entry.label) || "section";
    lines.push(`${indent}- [${entry.label}](#scribe-p${entry.page}-${anchor})`);
  }
  lines.push("");
  return lines.join("\n");
}

function refreshIndexPreviewLocal() {
  paintIndexUi({ markdown: localIndexMarkdown(), applied: state.indexApplied });
}

function refreshIndexPreviewOnly() {
  const preview = $("index-preview");
  if (preview) {
    preview.innerHTML = renderMarkdown(localIndexMarkdown(), {
      resolveImageUrl: (src) => (state.project ? resolvePreviewImageUrl(state.project.id, src, 1) : src),
    });
  }
  paintIndexMeta();
}

async function loadIndexPanel() {
  const p = state.project;
  if (!p) return;
  try {
    const index = await fetchIndex(p.id);
    applyIndexState(index);
    showNotice("index", "");
  } catch (err) {
    showNotice("index", err.message || String(err), "error");
  }
}

async function followScribeLink(href) {
  const parsed = parseScribeHref(href);
  if (!parsed || !state.project) return false;
  activateProcTab("proc-panel-edit");
  await goToEditPage(parsed.page);
  requestAnimationFrame(() => {
    const root = $("edit-md-rendered");
    if (!root || state.editView !== "rendered") return;
    const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const hit =
      headings.find((h) => slugifyHeading(h.textContent) === parsed.anchor) ||
      headings.find((h) => slugifyHeading(h.textContent).startsWith(parsed.anchor));
    hit?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  return true;
}

function fillExportMetadata(meta, { overwrite = false } = {}) {
  if (!meta) return;
  const set = (id, value) => {
    const el = $(id);
    if (!el) return;
    if (!overwrite && String(el.value || "").trim()) return;
    el.value = value ?? "";
  };
  set("export-title", meta.title || "");
  set("export-authors", meta.authors || meta.author || "");
  set("export-publisher", meta.publisher || "");
  set("export-year", meta.year || "");
  set("export-isbn", meta.isbn || "");
  set("export-language", meta.language || "en");
  set("export-description", meta.description || "");
  set("export-rights", meta.rights || "");
}

function scheduleExportMetaSave() {
  if (state.exportMetaLoading) return;
  state.exportMetaDirty = true;
  if (state.exportMetaSaveTimer) clearTimeout(state.exportMetaSaveTimer);
  state.exportMetaSaveTimer = setTimeout(() => void flushExportMetaSave(), 700);
}

async function flushExportMetaSave() {
  if (state.exportMetaSaveTimer) {
    clearTimeout(state.exportMetaSaveTimer);
    state.exportMetaSaveTimer = null;
  }
  const p = state.project;
  if (!p || !state.exportMetaDirty) return;
  try {
    await saveExportMetadata(p.id, collectExportPayload());
    state.exportMetaDirty = false;
  } catch (err) {
    showNotice("export", err.message || String(err), "error");
  }
}

function hideExportLookupResults() {
  const box = $("export-lookup-results");
  if (!box) return;
  box.classList.add("lego-hidden");
  box.innerHTML = "";
}

function paintExportLookupResults(results) {
  const box = $("export-lookup-results");
  if (!box) return;
  if (!results?.length) {
    hideExportLookupResults();
    return;
  }
  box.classList.remove("lego-hidden");
  box.innerHTML = results
    .map((row, i) => {
      const m = row.metadata || {};
      const title = escapeHtml(m.title || "Untitled");
      const bits = [m.authors, m.year, m.publisher, m.isbn].filter(Boolean).map(escapeHtml);
      return `<button type="button" class="export-lookup-item" role="option" data-lookup-index="${i}">
        <div class="export-lookup-item-title">${title}</div>
        <div class="export-lookup-item-meta">${bits.join(" · ")}</div>
      </button>`;
    })
    .join("");
  box._lookupResults = results;
}

async function runExportLookup() {
  const p = state.project;
  if (!p) return;
  const payload = {
    title: $("export-title")?.value?.trim() || "",
    authors: $("export-authors")?.value?.trim() || "",
    isbn: $("export-isbn")?.value?.trim() || "",
  };
  if (!payload.title && !payload.authors && !payload.isbn) {
    showNotice("export", "Enter a title, author, or ISBN before looking up.", "error");
    return;
  }
  if ($("export-lookup-btn")) $("export-lookup-btn").disabled = true;
  showNotice("export", "Searching Open Library…", "info");
  try {
    const data = await lookupExportMetadata(p.id, payload);
    const results = data.results || [];
    if (!results.length) {
      hideExportLookupResults();
      showNotice("export", "No matches found. Tweak the title/author/ISBN and try again.", "error");
      return;
    }
    // Auto-apply the top hit; keep the list so the user can pick another
    fillExportMetadata(results[0].metadata, { overwrite: true });
    state.exportMetaDirty = true;
    await flushExportMetaSave();
    paintExportLookupResults(results);
    showNotice(
      "export",
      results.length === 1
        ? "Applied the Open Library match."
        : `Applied the best match (${results.length} found). Click another result to switch.`,
      "info",
    );
  } catch (err) {
    hideExportLookupResults();
    showNotice("export", err.message || String(err), "error");
  } finally {
    if ($("export-lookup-btn")) $("export-lookup-btn").disabled = false;
  }
}

function collectExportPayload() {
  return {
    title: $("export-title")?.value?.trim() || state.project?.name || "",
    authors: $("export-authors")?.value?.trim() || "",
    publisher: $("export-publisher")?.value?.trim() || "",
    year: $("export-year")?.value?.trim() || "",
    isbn: $("export-isbn")?.value?.trim() || "",
    language: $("export-language")?.value?.trim() || "en",
    description: $("export-description")?.value?.trim() || "",
    rights: $("export-rights")?.value?.trim() || "",
  };
}

async function prepareExportPanel({ forceDetect = false } = {}) {
  const p = state.project;
  if (!p) return;
  const needsLoad = forceDetect || state.exportMetaProjectId !== p.id;
  if (!needsLoad) return;
  state.exportMetaLoading = true;
  try {
    const data = await fetchExportMetadata(p.id, { detect: forceDetect });
    const meta = data.metadata || data;
    fillExportMetadata(meta, { overwrite: true });
    if (!$("export-title")?.value) $("export-title").value = p.name || "";
    state.exportMetaProjectId = p.id;
    state.exportMetaDirty = false;
    if (forceDetect) {
      // Persist detect results so they aren't lost on reload
      state.exportMetaDirty = true;
      await flushExportMetaSave();
      showNotice("export", "Filled metadata from early pages — review before downloading.", "info");
    } else if (data.source === "detected") {
      // First visit: keep scrape in the form and save so later opens don't re-scrape
      state.exportMetaDirty = true;
      await flushExportMetaSave();
    }
  } catch (err) {
    if (!$("export-title")?.value) $("export-title").value = p.name || "";
    if (forceDetect) showNotice("export", err.message || String(err), "error");
  } finally {
    state.exportMetaLoading = false;
  }
}

let vllmRetry = null;

function vllmFailureText(err) {
  return err?.detailText || err?.message || "vLLM failed without an error message.";
}

function ocrProcessingNotice(engine) {
  return engine === "transformers"
    ? "Processing via Transformers (slow)…"
    : "Processing via vLLM (fast)…";
}

function showVllmFailure(detail, retry) {
  vllmRetry = retry;
  const pre = $("vllm-fail-detail");
  if (pre) pre.textContent = detail || "vLLM failed without an error message.";
  $("vllm-fail-dialog")?.classList.remove("lego-hidden");
}

function hideVllmFailure() {
  $("vllm-fail-dialog")?.classList.add("lego-hidden");
  vllmRetry = null;
}

async function submitOcr(payload) {
  if (!state.project) return;
  const engine = payload.engine === "transformers" ? "transformers" : "vllm";
  state.ocrRunEngine = engine;
  showNotice(
    "ocr",
    engine === "transformers"
      ? ocrProcessingNotice(engine)
      : "Starting the OCR engine… loading the model before processing pages.",
    "info",
  );
  const data = await startOcr(state.project.id, payload);
  state.project = data.project;
  state.ocrRunEngine = data.job?.result?.engine || engine;
  syncOcrFormFromProject();
  renderProject();
  showNotice("ocr", ocrProcessingNotice(state.ocrRunEngine), "info");
  maybePollOcr();
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function maybePollOcr() {
  stopPoll();
  const p = state.project;
  if (!p || p.status !== "ocr_running" || !p.last_job_id) return;
  state.pollTimer = setInterval(() => void pollOnce(), 1500);
  void pollOnce();
}

async function pollOnce() {
  const p = state.project;
  if (!p?.last_job_id) return;
  try {
    const job = await fetchJob(p.last_job_id);
    state.project = await fetchProject(p.id);
    await refreshProcessedPages();
    renderProject();
    // Keep preview live as pages land
    void refreshPreview();
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
      stopPoll();
      if (job.status === "error" && job.result?.code === "vllm_unavailable") {
        showVllmFailure(job.result.detail || job.error || job.message, {
          kind: "ocr",
          payload: readOcrPayload(),
        });
      } else if (job.status === "error") showNotice("ocr", job.error || job.message || "OCR failed", "error");
      else if (job.status === "cancelled") {
        showNotice("ocr", "OCR cancelled. Pages finished before cancel are kept — you can process again.", "status");
      } else {
        showNotice("ocr", "Range complete — open Preview to review pages.", "info");
      }
    } else {
      const engine = job.result?.engine || state.ocrRunEngine;
      showNotice("ocr", ocrProcessingNotice(engine), "info");
    }
  } catch (err) {
    stopPoll();
    const message = err.message || String(err);
    // Job store is in-memory — restart/exit leaves project.json stuck on ocr_running.
    if (/not found/i.test(message) || /404/.test(message)) {
      try {
        state.project = await fetchProject(p.id);
        const interrupted = Boolean(state.project._ocr_interrupted);
        await refreshProcessedPages();
        renderProject();
        void refreshPreview();
        if (!interrupted) {
          showNotice(
            "ocr",
            "Previous OCR job was interrupted and is no longer running. You can process pages again.",
            "status",
          );
        }
      } catch (recoverErr) {
        showNotice("ocr", recoverErr.message || String(recoverErr), "error");
      }
      return;
    }
    showNotice("ocr", message, "error");
  }
}

function readOcrPayload() {
  const p = state.project;
  const total = p?.page_count || 1;
  let start = Number($("ocr-start-page")?.value || 1);
  let end = Number($("ocr-end-page")?.value || total);
  if (!Number.isFinite(start) || start < 1) start = 1;
  if (!Number.isFinite(end) || end < start) end = start;
  start = Math.min(start, total);
  end = Math.min(end, total);

  const cover_mode = selectedCoverMode();
  let cover_page = null;
  let cover_jpeg_quality = Number($("ocr-cover-quality")?.value || 85);
  if (!Number.isFinite(cover_jpeg_quality)) cover_jpeg_quality = 85;
  cover_jpeg_quality = Math.max(1, Math.min(95, cover_jpeg_quality));

  if (cover_mode === "page" || cover_mode === "upload") {
    cover_page = Number($("ocr-cover-page")?.value || 1);
    if (!Number.isFinite(cover_page) || cover_page < 1) cover_page = 1;
    cover_page = Math.min(cover_page, total);
  }

  const payload = {
    start_page: start,
    end_page: end,
    cover_mode,
    cover_jpeg_quality,
    fade_threshold: Math.max(0, Math.min(100, Number($("ocr-fade-threshold")?.value || 0) || 0)),
  };
  if (cover_mode === "none") {
    payload.clear_cover = true;
    payload.cover_page = null;
  } else {
    payload.cover_page = cover_page;
  }
  return payload;
}

function wireActions() {
  $("create-btn")?.addEventListener("click", async () => {
    const name = $("new-name")?.value?.trim();
    const description = $("new-desc")?.value?.trim() || "";
    if (!name) {
      showNotice("home", "Enter a project name.", "error");
      return;
    }
    try {
      const project = await createProject(name, description);
      $("new-name").value = "";
      $("new-desc").value = "";
      await openProject(project.id);
    } catch (err) {
      showNotice("home", err.message || String(err), "error");
    }
  });

  $("project-list")?.addEventListener("click", async (ev) => {
    const openId = ev.target?.closest?.("[data-open]")?.getAttribute("data-open");
    const deleteId = ev.target?.closest?.("[data-delete]")?.getAttribute("data-delete");
    if (openId) void openProject(openId);
    if (deleteId) {
      if (!confirm("Delete this project and its files?")) return;
      try {
        await deleteProject(deleteId);
        await refreshProjectList();
      } catch (err) {
        showNotice("home", err.message || String(err), "error");
      }
    }
  });

  $("project-sort-key")?.addEventListener("change", (ev) => {
    state.projectSortKey = ev.target.value;
    void refreshProjectList();
  });
  $("project-sort-dir")?.addEventListener("change", (ev) => {
    state.projectSortDir = ev.target.value;
    void refreshProjectList();
  });

  $("close-project-btn")?.addEventListener("click", () => void closeProject());

  $("upload-btn")?.addEventListener("click", async () => {
    const file = $("source-file")?.files?.[0];
    if (!file || !state.project) {
      showNotice("doc", "Choose a PDF or image first.", "error");
      return;
    }
    try {
      showNotice("doc", "Uploading…", "status");
      state.project = await uploadSource(state.project.id, file);
      state.processedSet = new Set();
      state.previewPage = 1;
      syncOcrFormFromProject();
      showNotice("doc", `Loaded ${state.project.source_filename}`, "info");
      renderProject();
      void refreshPreview();
    } catch (err) {
      showNotice("doc", err.message || String(err), "error");
    }
  });

  $("ocr-fade-threshold")?.addEventListener("input", (ev) => {
    updateFadeThresholdLabel(ev.target?.value);
  });

  $("ocr-btn")?.addEventListener("click", async () => {
    if (!state.project) return;
    if (!isModelsReady()) {
      openSettings("models");
      showNotice("ocr", "Install LightOnOCR-2-1B in Settings → Models first.", "error");
      return;
    }
    let payload = null;
    try {
      clearNotices("ocr");
      payload = readOcrPayload();
      if (payload.cover_mode === "upload" && !state.project.has_cover_upload) {
        showNotice("ocr", "Save a cover image before processing with Upload image.", "error");
        return;
      }
      await submitOcr(payload);
    } catch (err) {
      if (err?.code === "vllm_unavailable") {
        showNotice("ocr", "Faster OCR engine failed.", "error");
        showVllmFailure(vllmFailureText(err), { kind: "ocr", payload });
        return;
      }
      showNotice("ocr", err.message || String(err), "error");
    }
  });

  async function rerunAfterVllmChoice(engine) {
    const pending = vllmRetry;
    hideVllmFailure();
    if (!pending || !state.project) return;
    try {
      if (pending.kind === "region") {
        const region = { ...pending.region };
        if (engine) region.engine = engine;
        const result = await regionOcr(state.project.id, pending.page, region);
        if (result.project) state.project = result.project;
        state.editDraft = result.markdown || "";
        state.editSaved = state.editDraft;
        state.editDirty = false;
        setEditSaveStatus("Saved");
        paintEditEditor();
        if (state.previewPage === pending.page) void refreshPreview();
        showNotice("edit", "Page Markdown replaced with the re-scanned region.", "info");
        return;
      }
      const payload = { ...pending.payload };
      if (engine) payload.engine = engine;
      else delete payload.engine;
      await submitOcr(payload);
    } catch (err) {
      if (err?.code === "vllm_unavailable") {
        showVllmFailure(vllmFailureText(err), pending);
        return;
      }
      showNotice(pending.kind === "region" ? "edit" : "ocr", err.message || String(err), "error");
    }
  }

  $("vllm-fail-retry")?.addEventListener("click", () => {
    void rerunAfterVllmChoice("");
  });
  $("vllm-fail-transformers")?.addEventListener("click", () => {
    void rerunAfterVllmChoice("transformers");
  });
  $("vllm-fail-abort")?.addEventListener("click", () => {
    hideVllmFailure();
    showNotice("ocr", "OCR aborted.", "status");
  });

  $("ocr-cancel-btn")?.addEventListener("click", async () => {
    if (!state.project) return;
    try {
      $("ocr-cancel-btn").disabled = true;
      showNotice("ocr", "Cancelling… will stop after the current page.", "status");
      const data = await cancelOcr(state.project.id);
      if (data.project) state.project = data.project;
      maybePollOcr();
    } catch (err) {
      showNotice("ocr", err.message || String(err), "error");
      if ($("ocr-cancel-btn")) $("ocr-cancel-btn").disabled = false;
    }
  });

  $("ocr-clear-cover-btn")?.addEventListener("click", async () => {
    if (!state.project) return;
    try {
      state.project = await patchProject(state.project.id, { clear_cover: true });
      setCoverMode("none", { syncOnly: true });
      if ($("cover-upload-name")) $("cover-upload-name").textContent = "";
      if ($("cover-file")) $("cover-file").value = "";
      showNotice("ocr", "Cover cleared for future runs.", "info");
      void refreshCoverPreview();
    } catch (err) {
      showNotice("ocr", err.message || String(err), "error");
    }
  });

  document.querySelectorAll('input[name="cover-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const mode = selectedCoverMode();
      setCoverMode(mode);
      if (mode === "upload" && state.project && !state.project.has_cover_upload) {
        showNotice("ocr", "Choose an image and click Save cover image.", "info");
      }
    });
  });

  $("cover-file")?.addEventListener("change", () => scheduleCoverPreview());
  $("ocr-cover-page")?.addEventListener("input", () => scheduleCoverPreview());
  $("ocr-cover-quality")?.addEventListener("input", () => scheduleCoverPreview());

  $("cover-upload-btn")?.addEventListener("click", async () => {
    if (!state.project) return;
    const file = $("cover-file")?.files?.[0];
    if (!file) {
      showNotice("ocr", "Choose a cover image first.", "error");
      return;
    }
    try {
      showNotice("ocr", "Saving cover image…", "status");
      state.project = await uploadCover(state.project.id, file);
      if ($("cover-file")) $("cover-file").value = "";
      setCoverMode("upload", { syncOnly: true });
      if ($("cover-upload-name")) $("cover-upload-name").textContent = "Cover image saved on this project.";
      $("cover-actions")?.classList.remove("lego-hidden");
      showNotice("ocr", "Cover image saved. Adjust quality, then process pages.", "info");
      void refreshCoverPreview();
    } catch (err) {
      showNotice("ocr", err.message || String(err), "error");
    }
  });

  $("cover-preview-btn")?.addEventListener("click", () => openCoverLightbox());
  $("cover-lightbox-close")?.addEventListener("click", () => closeCoverLightbox());
  $("cover-lightbox")?.addEventListener("click", (ev) => {
    if (ev.target === $("cover-lightbox")) closeCoverLightbox();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!$("region-lightbox")?.classList.contains("lego-hidden")) {
      if (!$("region-lightbox")?.classList.contains("is-busy")) closeRegionLightbox();
      return;
    }
    if (!$("insert-image-modal")?.classList.contains("lego-hidden")) {
      closeInsertImageModal();
      return;
    }
    closeCoverLightbox();
  });

  $("preview-prev-btn")?.addEventListener("click", () => {
    state.previewPage = Math.max(1, state.previewPage - 1);
    void refreshPreview();
  });
  $("preview-next-btn")?.addEventListener("click", () => {
    const total = state.project?.page_count || 1;
    state.previewPage = Math.min(total, state.previewPage + 1);
    void refreshPreview();
  });
  $("preview-page-num")?.addEventListener("change", () => {
    const total = state.project?.page_count || 1;
    let n = Number($("preview-page-num").value || 1);
    if (!Number.isFinite(n)) n = 1;
    state.previewPage = Math.max(1, Math.min(total, n));
    void refreshPreview();
  });

  $("proc-tab-cleaning")?.addEventListener("click", () => {
    if (!state.processedSet.size) {
      state.cleanPage = 1;
    } else if (!state.processedSet.has(state.cleanPage)) {
      state.cleanPage = firstProcessedPage();
    }
    void analyzeCleaning();
    scheduleCleanPreview();
  });

  $("clean-analyze-btn")?.addEventListener("click", () => void analyzeCleaning({ force: true }));
  $("clean-opt-page-numbers")?.addEventListener("change", () => scheduleCleanPreview());
  $("clean-opt-running")?.addEventListener("change", () => scheduleCleanPreview());
  $("clean-header-pattern")?.addEventListener("input", () => scheduleCleanPreview());
  $("clean-candidates")?.addEventListener("change", () => scheduleCleanPreview());

  $("clean-view-rendered")?.addEventListener("click", () => setCleanView("rendered"));
  $("clean-view-raw")?.addEventListener("click", () => setCleanView("raw"));

  $("clean-prev-btn")?.addEventListener("click", () => {
    const pages = [...state.processedSet].sort((a, b) => a - b);
    if (!pages.length) return;
    const idx = pages.indexOf(state.cleanPage);
    const next = idx <= 0 ? pages[0] : pages[idx - 1];
    state.cleanPage = next;
    scheduleCleanPreview();
  });
  $("clean-next-btn")?.addEventListener("click", () => {
    const pages = [...state.processedSet].sort((a, b) => a - b);
    if (!pages.length) return;
    const idx = pages.indexOf(state.cleanPage);
    const next = idx < 0 || idx >= pages.length - 1 ? pages[pages.length - 1] : pages[idx + 1];
    state.cleanPage = next;
    scheduleCleanPreview();
  });
  $("clean-page-num")?.addEventListener("change", () => {
    const total = state.project?.page_count || 1;
    let n = Number($("clean-page-num").value || 1);
    if (!Number.isFinite(n)) n = 1;
    state.cleanPage = Math.max(1, Math.min(total, n));
    scheduleCleanPreview();
  });

  $("clean-apply-btn")?.addEventListener("click", async () => {
    if (!state.project) return;
    if (!state.processedSet.size) {
      showNotice("cleaning", "No processed pages to clean yet.", "error");
      return;
    }
    const options = readCleanOptions();
    if (
      !options.remove_page_numbers &&
      !(options.header_pattern || options.book_title) &&
      !(options.remove_running_headers && options.selected_running.length)
    ) {
      showNotice("cleaning", "Choose at least one cleaning option before applying.", "error");
      return;
    }
    if (
      !confirm(
        "Apply cleaning to all processed pages? Cover pages are skipped. This overwrites their Markdown files.",
      )
    ) {
      return;
    }
    try {
      $("clean-apply-btn").disabled = true;
      showNotice("cleaning", "Applying cleaning…", "status");
      const result = await applyCleaning(state.project.id, options);
      if (result.project) state.project = result.project;
      await refreshProcessedPages();
      state.cleanAnalyzed = false;
      showNotice(
        "cleaning",
        `Cleaning done — updated ${result.updated}, unchanged ${result.unchanged}, skipped ${result.skipped}.`,
        "info",
      );
      scheduleCleanPreview();
      void refreshPreview();
      void refreshEdit();
    } catch (err) {
      showNotice("cleaning", err.message || String(err), "error");
    } finally {
      if ($("clean-apply-btn")) $("clean-apply-btn").disabled = false;
    }
  });

  $("proc-tab-edit")?.addEventListener("click", () => {
    if (!state.processedSet.size) {
      state.editPage = 1;
    } else if (!state.processedSet.has(state.editPage)) {
      state.editPage = firstProcessedPage();
    }
    void refreshEdit();
  });

  $("proc-tab-index")?.addEventListener("click", () => {
    void loadIndexPanel();
  });
  $("proc-tab-export")?.addEventListener("click", () => {
    void prepareExportPanel();
  });

  for (const tabId of ["proc-tab-preview", "proc-tab-cleaning", "proc-tab-index", "proc-tab-export"]) {
    $(tabId)?.addEventListener("click", () => {
      void flushEditSave();
      void flushIndexSave();
      void flushExportMetaSave();
    });
  }

  $("index-scan-btn")?.addEventListener("click", async () => {
    const p = state.project;
    if (!p) return;
    await flushIndexSave();
    if ($("index-scan-btn")) $("index-scan-btn").disabled = true;
    try {
      const payload = collectIndexPayload();
      const index = await scanIndex(p.id, {
        replace_start: payload.replace_start,
        replace_end: payload.replace_end,
        title: payload.title,
        keep_manual: true,
      });
      applyIndexState(index);
      showNotice("index", `Found ${index.enabled_count ?? index.entries?.length ?? 0} titles.`, "info");
    } catch (err) {
      showNotice("index", err.message || String(err), "error");
    } finally {
      if ($("index-scan-btn")) $("index-scan-btn").disabled = false;
    }
  });

  $("index-apply-btn")?.addEventListener("click", async () => {
    const p = state.project;
    if (!p) return;
    await flushIndexSave();
    document.querySelectorAll(".index-entry").forEach((row) => syncIndexEntryFromDom(row));
    const payload = collectIndexPayload();
    if (payload.replace_start == null) {
      showNotice("index", "Set the original index page range (from–to) before applying.", "error");
      return;
    }
    if ($("index-apply-btn")) $("index-apply-btn").disabled = true;
    try {
      const data = await applyIndex(p.id, payload);
      if (data.project) state.project = data.project;
      applyIndexState(data.index);
      await refreshProcessedPages();
      showNotice("index", "Contents written to the selected page range.", "info");
    } catch (err) {
      showNotice("index", err.message || String(err), "error");
    } finally {
      if ($("index-apply-btn")) $("index-apply-btn").disabled = false;
    }
  });

  $("index-add-btn")?.addEventListener("click", () => {
    document.querySelectorAll(".index-entry").forEach((row) => syncIndexEntryFromDom(row));
    state.indexEntries.push({
      id: `manual-${Date.now().toString(36)}`,
      label: "New entry",
      page: firstProcessedPage() || 1,
      anchor: "new-entry",
      level: 1,
      enabled: true,
      source: "manual",
    });
    refreshIndexPreviewLocal();
    scheduleIndexSave();
  });

  $("index-entries")?.addEventListener("input", (ev) => {
    const row = ev.target?.closest?.(".index-entry");
    if (!row) return;
    syncIndexEntryFromDom(row);
    // Don't re-sort while typing a page number (e.g. "1" → "17")
    refreshIndexPreviewOnly();
    scheduleIndexSave();
  });
  $("index-entries")?.addEventListener("change", (ev) => {
    const row = ev.target?.closest?.(".index-entry");
    if (!row) return;
    syncIndexEntryFromDom(row);
    if (ev.target?.getAttribute?.("data-index-field") === "page") {
      refreshIndexPreviewLocal();
    } else {
      refreshIndexPreviewOnly();
    }
    scheduleIndexSave();
  });
  $("index-entries")?.addEventListener("click", (ev) => {
    const indentBtn = ev.target?.closest?.("[data-index-indent]");
    if (indentBtn) {
      bumpIndexLevel(Number(indentBtn.getAttribute("data-index-indent")), 1);
      return;
    }
    const outdentBtn = ev.target?.closest?.("[data-index-outdent]");
    if (outdentBtn) {
      bumpIndexLevel(Number(outdentBtn.getAttribute("data-index-outdent")), -1);
      return;
    }
    const removeBtn = ev.target?.closest?.("[data-index-remove]");
    if (removeBtn) {
      const i = Number(removeBtn.getAttribute("data-index-remove"));
      document.querySelectorAll(".index-entry").forEach((row) => syncIndexEntryFromDom(row));
      if (Number.isFinite(i)) state.indexEntries.splice(i, 1);
      refreshIndexPreviewLocal();
      scheduleIndexSave();
      return;
    }
    const gotoBtn = ev.target?.closest?.("[data-index-goto]");
    if (gotoBtn) {
      const i = Number(gotoBtn.getAttribute("data-index-goto"));
      const entry = state.indexEntries[i];
      if (!entry) return;
      void followScribeLink(`#scribe-p${entry.page}-${entry.anchor || slugifyHeading(entry.label)}`);
    }
  });

  $("index-title")?.addEventListener("input", () => {
    refreshIndexPreviewOnly();
    scheduleIndexSave();
  });
  $("index-replace-start")?.addEventListener("change", () => scheduleIndexSave());
  $("index-replace-end")?.addEventListener("change", () => scheduleIndexSave());
  $("index-replace-start")?.addEventListener("input", () => scheduleIndexSave());
  $("index-replace-end")?.addEventListener("input", () => scheduleIndexSave());

  $("export-detect-btn")?.addEventListener("click", () => {
    void prepareExportPanel({ forceDetect: true });
  });

  $("export-lookup-btn")?.addEventListener("click", () => {
    void runExportLookup();
  });

  for (const id of [
    "export-title",
    "export-authors",
    "export-publisher",
    "export-year",
    "export-isbn",
    "export-language",
    "export-description",
    "export-rights",
  ]) {
    $(id)?.addEventListener("input", () => scheduleExportMetaSave());
    $(id)?.addEventListener("change", () => scheduleExportMetaSave());
  }

  $("export-lookup-results")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-lookup-index]");
    if (!btn) return;
    const i = Number(btn.getAttribute("data-lookup-index"));
    const results = $("export-lookup-results")?._lookupResults || [];
    const row = results[i];
    if (!row?.metadata) return;
    fillExportMetadata(row.metadata, { overwrite: true });
    state.exportMetaDirty = true;
    void flushExportMetaSave();
    showNotice("export", `Applied: ${row.metadata.title || "selected match"}.`, "info");
  });

  $("export-epub-btn")?.addEventListener("click", async () => {
    const p = state.project;
    if (!p) return;
    await flushExportMetaSave();
    if ($("export-epub-btn")) $("export-epub-btn").disabled = true;
    showNotice("export", "Building EPUB…", "info");
    try {
      const { blob, filename } = await downloadEpub(p.id, collectExportPayload());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showNotice("export", `Downloaded ${filename}.`, "info");
    } catch (err) {
      showNotice("export", err.message || String(err), "error");
    } finally {
      if ($("export-epub-btn")) $("export-epub-btn").disabled = false;
    }
  });

  document.addEventListener("click", (ev) => {
    const link = ev.target?.closest?.("a.scribe-index-link");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (!parseScribeHref(href)) return;
    ev.preventDefault();
    void followScribeLink(href);
  });

  $("edit-view-toggle")?.addEventListener("click", () => {
    setEditView(state.editView === "raw" ? "rendered" : "raw");
  });

  $("edit-rescan-btn")?.addEventListener("click", () => openRegionLightbox("rescan"));
  $("edit-extract-btn")?.addEventListener("click", () => openRegionLightbox("extract"));
  $("region-lightbox-cancel")?.addEventListener("click", () => {
    if (!$("region-lightbox")?.classList.contains("is-busy")) closeRegionLightbox();
  });
  $("region-lightbox-confirm")?.addEventListener("click", () => void confirmRegionSelection());

  $("region-stage")?.addEventListener("pointerdown", (ev) => {
    if ($("region-lightbox")?.classList.contains("is-busy")) return;
    const img = $("region-lightbox-img");
    if (!img?.naturalWidth) return;
    ev.preventDefault();
    const origin = clientToImageNorm(img, ev.clientX, ev.clientY);
    state.regionDragging = true;
    state.regionOrigin = origin;
    state.regionNorm = { x: origin.x, y: origin.y, width: 0, height: 0 };
    paintRegionSelection(state.regionNorm);
    $("region-stage")?.setPointerCapture?.(ev.pointerId);
  });
  $("region-stage")?.addEventListener("pointermove", (ev) => {
    if (!state.regionDragging || !state.regionOrigin) return;
    const img = $("region-lightbox-img");
    if (!img) return;
    const cur = clientToImageNorm(img, ev.clientX, ev.clientY);
    const x = Math.min(state.regionOrigin.x, cur.x);
    const y = Math.min(state.regionOrigin.y, cur.y);
    state.regionNorm = {
      x,
      y,
      width: Math.abs(cur.x - state.regionOrigin.x),
      height: Math.abs(cur.y - state.regionOrigin.y),
    };
    paintRegionSelection(state.regionNorm);
  });
  const endRegionDrag = (ev) => {
    if (!state.regionDragging) return;
    state.regionDragging = false;
    try {
      $("region-stage")?.releasePointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
  };
  $("region-stage")?.addEventListener("pointerup", endRegionDrag);
  $("region-stage")?.addEventListener("pointercancel", endRegionDrag);
  window.addEventListener("resize", () => {
    if (!$("region-lightbox")?.classList.contains("lego-hidden")) {
      paintRegionSelection(state.regionNorm);
    }
  });

  $("edit-insert-image-btn")?.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    saveEditCaret();
  });
  $("edit-insert-image-btn")?.addEventListener("click", () => void openInsertImageModal());
  $("insert-image-close")?.addEventListener("click", () => closeInsertImageModal());
  $("insert-image-modal")?.addEventListener("click", (ev) => {
    if (ev.target === $("insert-image-modal")) closeInsertImageModal();
  });
  $("insert-image-grid")?.addEventListener("click", (ev) => {
    const card = ev.target?.closest?.("[data-filename]");
    if (!card) return;
    insertImageMarkdown(card.getAttribute("data-filename"));
  });

  $("edit-prev-btn")?.addEventListener("click", () => {
    void goToEditPage(Math.max(1, state.editPage - 1));
  });
  $("edit-next-btn")?.addEventListener("click", () => {
    const total = state.project?.page_count || 1;
    void goToEditPage(Math.min(total, state.editPage + 1));
  });
  $("edit-page-num")?.addEventListener("change", () => {
    const total = state.project?.page_count || 1;
    let n = Number($("edit-page-num").value || 1);
    if (!Number.isFinite(n)) n = 1;
    void goToEditPage(Math.max(1, Math.min(total, n)));
  });

  $("edit-md-raw")?.addEventListener("input", () => onEditInput());
  $("edit-md-rendered")?.addEventListener("input", () => onEditInput());
  $("edit-md-rendered")?.addEventListener("paste", (ev) => {
    // Prefer plain text so we don't ingest Word/HTML garbage into the MD round-trip
    ev.preventDefault();
    const text = ev.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });

  document.querySelector(".edit-format-bar")?.addEventListener("mousedown", (ev) => {
    // Keep selection in the editor when clicking toolbar buttons
    const btn = ev.target?.closest?.(
      "[data-edit-fmt], #edit-view-toggle, #edit-insert-image-btn, #edit-list-menu-btn",
    );
    if (!btn) return;
    ev.preventDefault();
    if (btn.getAttribute?.("data-edit-fmt") === "footnote" || btn.id === "edit-insert-image-btn") {
      saveEditCaret();
    }
  });

  function setListMenuOpen(open) {
    const menu = $("edit-list-menu");
    const toggle = $("edit-list-menu-btn");
    if (!menu || !toggle) return;
    menu.classList.toggle("lego-hidden", !open);
    if (open) menu.removeAttribute("hidden");
    else menu.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.classList.toggle("is-active", open);
  }

  $("edit-list-menu-btn")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const open = $("edit-list-menu")?.classList.contains("lego-hidden");
    setListMenuOpen(Boolean(open));
  });
  document.addEventListener("click", (ev) => {
    if (ev.target?.closest?.(".edit-fmt-menu")) return;
    setListMenuOpen(false);
  });

  document.querySelector(".edit-format-bar")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-edit-fmt]");
    if (!btn) return;
    const action = btn.getAttribute("data-edit-fmt");
    if (!action || !state.processedSet.has(state.editPage)) return;
    setListMenuOpen(false);
    if (state.editView === "raw") {
      applyRawFormat($("edit-md-raw"), action);
      onEditInput();
      return;
    }
    if (action === "footnote") {
      insertFootnoteInRenderedViaMarkdown();
      return;
    }
    applyRenderedFormat($("edit-md-rendered"), action);
    onEditInput();
  });

  $("edit-project-save")?.addEventListener("click", async () => {
    if (!state.project) return;
    try {
      state.project = await patchProject(state.project.id, {
        name: $("edit-name")?.value?.trim() || state.project.name,
        description: $("edit-desc")?.value?.trim() || "",
      });
      Lego.hide("edit-project-modal");
      renderProject();
    } catch (err) {
      showNotice("edit-project", err.message || String(err), "error");
    }
  });

  $("edit-project-btn")?.addEventListener("click", () => {
    if (!state.project) return;
    $("edit-name").value = state.project.name || "";
    $("edit-desc").value = state.project.description || "";
  });
}

async function boot() {
  wireHomeTabs();
  wireActions();
  await initSettings({
    onReadyChange: () => {
      if (state.project) renderProject();
    },
  });
  await refreshProjectList();
}

void boot();
