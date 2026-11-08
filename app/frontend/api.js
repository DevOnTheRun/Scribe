async function parseJson(response) {
  if (!response.ok) {
    const text = await response.text();
    let message = text || `${response.status} ${response.statusText}`;
    let code = "";
    let detailText = "";
    try {
      const payload = JSON.parse(text);
      if (typeof payload.detail === "string") message = payload.detail;
      else if (payload.detail && typeof payload.detail === "object") {
        code = payload.detail.code || "";
        detailText = payload.detail.detail || payload.detail.message || "";
        message = detailText || JSON.stringify(payload.detail);
      } else if (payload.detail) message = JSON.stringify(payload.detail);
      else if (typeof payload.message === "string") message = payload.message;
    } catch {
      // keep raw
    }
    const err = new Error(message);
    err.status = response.status;
    if (code) err.code = code;
    if (detailText) err.detailText = detailText;
    throw err;
  }
  return response.json();
}

export async function fetchHealth() {
  return parseJson(await fetch("/api/health"));
}

export async function fetchModels() {
  const data = await parseJson(await fetch("/api/models"));
  return data.models;
}

export async function fetchModelsStatus() {
  return parseJson(await fetch("/api/models/status"));
}

export async function installModelPack(packId) {
  const data = await parseJson(
    await fetch(`/api/models/${encodeURIComponent(packId)}/install`, { method: "POST" }),
  );
  return data.job;
}

export async function uninstallModelPack(packId) {
  const data = await parseJson(
    await fetch(`/api/models/${encodeURIComponent(packId)}`, { method: "DELETE" }),
  );
  return data.job;
}

export async function fetchModelJob(jobId) {
  const data = await parseJson(await fetch(`/api/models/jobs/${encodeURIComponent(jobId)}`));
  return data.job;
}

export async function fetchVllm() {
  return parseJson(await fetch("/api/vllm"));
}

export async function installVllm() {
  const data = await parseJson(await fetch("/api/vllm/install", { method: "POST" }));
  return data.job;
}

export async function uninstallVllm() {
  const data = await parseJson(await fetch("/api/vllm", { method: "DELETE" }));
  return data.job;
}

export async function fetchVllmJob(jobId) {
  const data = await parseJson(await fetch(`/api/vllm/jobs/${encodeURIComponent(jobId)}`));
  return data.job;
}

export async function fetchInferenceSettings() {
  return parseJson(await fetch("/api/settings/inference"));
}

export async function saveInferenceSettings(payload) {
  return parseJson(
    await fetch("/api/settings/inference", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function fetchProjects() {
  const data = await parseJson(await fetch("/api/projects"));
  return data.projects;
}

export async function fetchProject(id) {
  const data = await parseJson(await fetch(`/api/projects/${id}`));
  const project = data.project;
  if (data.ocr_interrupted) {
    project._ocr_interrupted = true;
  }
  return project;
}

export async function createProject(name, description) {
  const data = await parseJson(
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    }),
  );
  return data.project;
}

export async function patchProject(id, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return data.project;
}

export async function deleteProject(id) {
  return parseJson(await fetch(`/api/projects/${id}`, { method: "DELETE" }));
}

export async function uploadSource(projectId, file) {
  const form = new FormData();
  form.append("file", file);
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/source`, {
      method: "POST",
      body: form,
    }),
  );
  return data.project;
}

export async function uploadCover(projectId, file) {
  const form = new FormData();
  form.append("file", file);
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/cover`, {
      method: "POST",
      body: form,
    }),
  );
  return data.project;
}

export function coverPreviewUrl(projectId, { quality = 85, page = null, mode = null, bust = 0 } = {}) {
  const params = new URLSearchParams();
  params.set("quality", String(quality));
  if (page != null) params.set("page", String(page));
  if (mode) params.set("mode", String(mode));
  if (bust) params.set("t", String(bust));
  return `/api/projects/${encodeURIComponent(projectId)}/cover/preview?${params.toString()}`;
}

export async function startOcr(projectId, payload = {}) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return data;
}

export async function cancelOcr(projectId) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/ocr/cancel`, {
      method: "POST",
    }),
  );
  return data;
}

export async function fetchJob(jobId) {
  const data = await parseJson(await fetch(`/api/jobs/${encodeURIComponent(jobId)}`));
  return data.job;
}

export async function fetchPages(projectId) {
  const data = await parseJson(await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages`));
  return data.pages;
}

export async function fetchPageMarkdown(projectId, pageNum) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/markdown`),
  );
}

export async function savePageMarkdown(projectId, pageNum, markdown) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/markdown`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    }),
  );
}

export async function regionOcr(projectId, pageNum, region) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/region-ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(region),
    }),
  );
}

export async function extractPageImage(projectId, pageNum, region) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/extract-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(region),
    }),
  );
}

export async function fetchProjectImages(projectId, page = null) {
  const q = page != null ? `?page=${encodeURIComponent(page)}` : "";
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/images${q}`),
  );
}

export function assetImageUrl(projectId, filename, { bust = 0 } = {}) {
  const q = bust ? `?t=${bust}` : "";
  return `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(filename)}${q}`;
}

export async function fetchCleaningAnalyze(projectId) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/cleaning/analyze`),
  );
}

export async function previewCleaning(projectId, page, options) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/cleaning/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page, options }),
    }),
  );
}

export async function applyCleaning(projectId, options, range = {}) {
  return parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/cleaning/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ options, ...range }),
    }),
  );
}

export function pagePreviewUrl(projectId, pageNum, { bust = 0 } = {}) {
  const q = bust ? `?t=${bust}` : "";
  return `/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/preview${q}`;
}

export function pageImageUrl(projectId, pageNum, { bust = 0 } = {}) {
  const q = bust ? `?t=${bust}` : "";
  return `/api/projects/${encodeURIComponent(projectId)}/pages/${pageNum}/image${q}`;
}

export async function fetchIndex(projectId) {
  const data = await parseJson(await fetch(`/api/projects/${encodeURIComponent(projectId)}/index`));
  return data.index;
}

export async function saveIndex(projectId, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/index`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return data.index;
}

export async function scanIndex(projectId, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/index/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }),
  );
  return data.index;
}

export async function applyIndex(projectId, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/index/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }),
  );
  return data;
}

export async function fetchExportMetadata(projectId, { detect = false } = {}) {
  const qs = detect ? "?detect=true" : "";
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/export/metadata${qs}`),
  );
  return data;
}

export async function saveExportMetadata(projectId, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/export/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }),
  );
  return data.metadata;
}

export async function lookupExportMetadata(projectId, payload) {
  const data = await parseJson(
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/export/metadata/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }),
  );
  return data;
}

export async function downloadEpub(projectId, payload) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export/epub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `${response.status} ${response.statusText}`;
    try {
      const payloadJson = JSON.parse(text);
      if (typeof payloadJson.detail === "string") message = payloadJson.detail;
    } catch {
      /* keep */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  let filename = "book.epub";
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match) filename = match[1];
  return { blob, filename };
}
