import Lego from "./lego.js";
import {
  fetchHealth,
  fetchInferenceSettings,
  fetchModelJob,
  fetchModels,
  fetchModelsStatus,
  fetchVllm,
  fetchVllmJob,
  installModelPack,
  installVllm,
  saveInferenceSettings,
  uninstallModelPack,
  uninstallVllm,
} from "./api.js";
import {
  applyTheme,
  DEFAULT_MODE,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  getThemeSettings,
} from "./theme.js";

const POLL_MS = 1500;
const ESSENTIAL_ID = "lightonocr-2-1b";

const state = {
  gateRequired: false,
  models: [],
  status: null,
  inference: null,
  jobs: {},
  packErrors: {},
  vllm: null,
  vllmJob: null,
  vllmError: null,
  onReadyChange: null,
  modelsAccordionOpen: "settings-models-ocr",
};

const ui = {
  modal: () => document.getElementById("settings-modal"),
  gateBanner: () => document.getElementById("settings-gate-banner"),
  modelsList: () => document.getElementById("settings-models-list"),
  primaryColor: () => document.getElementById("settings-primary-color"),
  secondaryColor: () => document.getElementById("settings-secondary-color"),
  primarySwatch: () => document.getElementById("settings-primary-swatch"),
  secondarySwatch: () => document.getElementById("settings-secondary-swatch"),
  primaryHex: () => document.getElementById("settings-primary-hex"),
  secondaryHex: () => document.getElementById("settings-secondary-hex"),
  resetColorsBtn: () => document.getElementById("settings-reset-colors-btn"),
  darkToggle: () => document.getElementById("settings-dark-toggle"),
  darkLabel: () => document.getElementById("settings-dark-label"),
  ocrSelect: () => document.getElementById("settings-ocr-engine"),
  tempInput: () => document.getElementById("settings-temperature"),
  tokensInput: () => document.getElementById("settings-max-tokens"),
  closeBtn: () => document.getElementById("settings-close-btn"),
  doneBtn: () => document.getElementById("settings-done-btn"),
};

export function isModelsReady() {
  return Boolean(state.status?.ready);
}

export function openSettings(tab = "general") {
  const tabId =
    tab === "models" ? "settings-tab-models" : tab === "engine" ? "settings-tab-engine" : "settings-tab-general";
  Lego.show("settings-modal-panel");
  Lego.show(tabId);
  syncGeneralTab();
  syncGateChrome();
  void refreshSettingsData();
}

export function closeSettings() {
  if (state.gateRequired) return;
  Lego.hide("settings-modal");
}

function syncGateChrome() {
  const locked = state.gateRequired;
  ui.modal()?.classList.toggle("settings-modal-locked", locked);
  ui.gateBanner()?.classList.toggle("lego-hidden", !locked);
  if (ui.doneBtn()) {
    ui.doneBtn().disabled = locked;
    ui.doneBtn().title = locked ? "Install LightOnOCR-2-1B before leaving Settings" : "Close settings";
  }
  if (ui.closeBtn()) {
    ui.closeBtn().disabled = locked;
    ui.closeBtn().title = locked ? "Install LightOnOCR-2-1B before closing" : "Close";
  }
}

function syncGeneralTab() {
  const theme = getThemeSettings();
  if (ui.primaryColor()) {
    ui.primaryColor().value = theme.primary;
    if (ui.primarySwatch()) ui.primarySwatch().style.backgroundColor = theme.primary;
    if (ui.primaryHex()) ui.primaryHex().textContent = theme.primary;
  }
  if (ui.secondaryColor()) {
    ui.secondaryColor().value = theme.secondary;
    if (ui.secondarySwatch()) ui.secondarySwatch().style.backgroundColor = theme.secondary;
    if (ui.secondaryHex()) ui.secondaryHex().textContent = theme.secondary;
  }
  if (ui.darkToggle()) {
    ui.darkToggle().checked = theme.mode === "dark";
    if (ui.darkLabel()) ui.darkLabel().textContent = theme.mode === "dark" ? "Dark" : "Light";
  }
}

function packStatusLabel(pack) {
  const job = state.jobs[pack.id];
  if (job) return job.action === "uninstall" ? "Uninstalling…" : "Installing…";
  if (state.packErrors[pack.id]) return pack.installed ? "Incomplete" : "Failed";
  return pack.installed ? "Installed" : "Missing";
}

function packStatusClass(pack) {
  const job = state.jobs[pack.id];
  if (job) return job.action === "uninstall" ? "is-uninstalling" : "is-installing";
  if (state.packErrors[pack.id]) return "is-failed";
  return pack.installed ? "is-ready" : "is-missing";
}

function sectionInstallBadge(packs) {
  if (!packs.length) return { label: "None Installed", tone: "is-none" };
  const installed = packs.filter((p) => p.installed).length;
  if (installed === 0) return { label: "None Installed", tone: "is-none" };
  if (installed === packs.length) return { label: "All Installed", tone: "is-all" };
  return { label: "Some Installed", tone: "is-some" };
}

function sectionBusyBadge(packs) {
  const uninstalling = packs.some((p) => state.jobs[p.id]?.action === "uninstall");
  if (uninstalling) return { label: "Uninstalling…", tone: "is-uninstalling" };
  const installing = packs.some((p) => state.jobs[p.id] && state.jobs[p.id].action !== "uninstall");
  if (installing) return { label: "Installing…", tone: "is-installing" };
  return null;
}

function formatBytes(num) {
  let value = Math.max(0, Number(num) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  for (let i = 0; i < units.length; i += 1) {
    if (value < 1024 || i === units.length - 1) {
      if (units[i] === "B") return `${Math.round(value)} B`;
      return `${value.toFixed(1)} ${units[i]}`;
    }
    value /= 1024;
  }
  return `${Math.round(Number(num) || 0)} B`;
}

function parseByteAmount(text) {
  const match = String(text || "")
    .trim()
    .match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase().replace("I", "");
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return value * (mult[unit] || 1);
}

function formatPercentProgress(doneLabel, totalLabel) {
  const done = parseByteAmount(doneLabel);
  const total = parseByteAmount(totalLabel);
  let pct = 0;
  if (done != null && total != null && total > 0) {
    pct = Math.min(100, Math.floor((done / total) * 100));
  }
  return `${pct}% (${doneLabel} / ${totalLabel}) downloaded`;
}

function humanizeDownloadProgress(raw) {
  const text = String(raw || "").trim();
  if (!text) return "Downloading…";

  const pctMatch = text.match(
    /(\d+)\s*%\s*\(\s*([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)\s*\)/i,
  );
  if (pctMatch) {
    return `${pctMatch[1]}% (${pctMatch[2]} / ${pctMatch[3]}) downloaded`;
  }

  const bytesMatch = text.match(
    /(?:Downloading\s+.+?:\s*)?([\d.]+\s*[KMGT]?i?B)\s*\/\s*([\d.]+\s*[KMGT]?i?B)/i,
  );
  if (bytesMatch) {
    return formatPercentProgress(bytesMatch[1], bytesMatch[2]);
  }

  const rawBytes = text.match(/(?:Downloading\s+.+?:\s*)?(\d+)\s*\/\s*(\d+)\s*$/);
  if (rawBytes && Number(rawBytes[2]) >= 1000) {
    return formatPercentProgress(
      formatBytes(Number(rawBytes[1])),
      formatBytes(Number(rawBytes[2])),
    );
  }

  if (/^copying\b/i.test(text)) return text;
  if (/already installed/i.test(text)) return text;
  if (/^starting/i.test(text)) return "Starting…";
  if (/ready$/i.test(text) || /^done$/i.test(text)) return text;
  if (/removing/i.test(text)) return text;
  if (/stopping the ocr engine/i.test(text)) return text;
  if (/^\[install-vllm\]/i.test(text)) return text.replace(/^\[install-vllm\]\s*/i, "");
  if (/fetching files|files downloaded|\/\s*\d+\s*files/i.test(text)) {
    return "Downloading…";
  }
  return "Downloading…";
}

function setPackProgress(packId, { visible, message, error, spinning = true }) {
  const row = document.querySelector(`[data-progress-for="${packId}"]`);
  if (!row) return;
  row.classList.toggle("lego-hidden", !visible);
  const spinner = row.querySelector(".settings-progress-spinner");
  const msg = row.querySelector(".settings-progress-msg");
  const showSpinner = Boolean(visible && spinning && !error);
  spinner?.classList.toggle("lego-hidden", !showSpinner);
  row.classList.toggle("is-error", Boolean(error));
  if (msg) {
    msg.textContent = error || (message ? humanizeDownloadProgress(message) : "") || "Downloading…";
  }
}

function renderPackHtml(pack) {
  const job = state.jobs[pack.id];
  const busy = Boolean(job);
  const err = state.packErrors[pack.id];
  const statusClass = packStatusClass(pack);
  const recommendedPill = pack.recommended
    ? `<span class="settings-pack-pill is-recommended">Recommended</span>`
    : "";

  let actions = "";
  if (err) {
    actions = `<button type="button" class="lego-style-bttnmain settings-pack-install" data-pack-id="${pack.id}" ${
      busy ? "disabled" : ""
    }>Retry</button>`;
    if (pack.installed) {
      actions += `<button type="button" class="lego-style-bttnhollow settings-pack-uninstall" data-pack-id="${pack.id}" ${
        busy ? "disabled" : ""
      }>Uninstall</button>`;
    }
  } else if (pack.installed) {
    actions = `<button type="button" class="lego-style-bttnhollow settings-pack-uninstall" data-pack-id="${pack.id}" ${
      busy ? "disabled" : ""
    }>Uninstall</button>`;
  } else {
    actions = `<button type="button" class="lego-style-bttnmain settings-pack-install" data-pack-id="${pack.id}" ${
      busy ? "disabled" : ""
    }>Install</button>`;
  }

  const progressHidden = err || busy ? "" : "lego-hidden";
  const progressMsg = err || (busy ? humanizeDownloadProgress(job.message || "Starting…") : "");
  const spinnerHidden = err || !busy ? "lego-hidden" : "";
  const progressError = err ? "is-error" : "";

  return `
    <article class="settings-pack ${statusClass}" data-pack-id="${pack.id}">
      <div class="settings-pack-head">
        <div>
          <h4>${pack.label}</h4>
          <p class="lego-style-muted">${pack.description}</p>
          <p class="settings-pack-meta lego-style-muted">${pack.size_hint || ""} · ${pack.kind || "optional"}</p>
        </div>
        <div class="settings-pack-pills">
          ${recommendedPill}
          <span class="settings-pack-pill is-status">${packStatusLabel(pack)}</span>
        </div>
      </div>
      <div class="settings-pack-progress ${progressHidden} ${progressError}" data-progress-for="${pack.id}">
        <span class="settings-progress-spinner ${spinnerHidden}" aria-hidden="true"></span>
        <p class="settings-progress-msg lego-style-muted">${progressMsg}</p>
      </div>
      <div class="settings-pack-actions">${actions}</div>
    </article>
  `;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function vllmBadge(info) {
  const job = state.vllmJob;
  if (job) {
    return job.action === "uninstall"
      ? { label: "Uninstalling…", tone: "is-uninstalling" }
      : { label: "Installing…", tone: "is-installing" };
  }
  if (!info?.available) return { label: "Unavailable", tone: "is-none" };
  if (info.installed) return { label: "Installed", tone: "is-all" };
  return { label: "Not installed", tone: "is-none" };
}

function renderVllmInner(info) {
  const job = state.vllmJob;
  const err = state.vllmError;
  const busy = Boolean(job);
  const hint = info.available
    ? "Optional faster OCR, about 6 GB. It is stored on a Pinokio drive (vllm/env-vllm) and linked into this app, so other programs can share it. The environment uses an isolated Python 3.12 and the LightOnOCR weights you already download. Windows installs a community CUDA wheel; Linux installs official vLLM."
    : info.reason || "vLLM is not available on this machine. OCR uses Transformers.";
  let actions = "";
  if (info.available) {
    const installBtn = `<button type="button" class="lego-style-bttnmain settings-vllm-install" ${busy ? "disabled" : ""}>${
      err ? "Retry" : "Install"
    }</button>`;
    const uninstallBtn = `<button type="button" class="lego-style-bttnhollow settings-vllm-uninstall" ${
      busy ? "disabled" : ""
    }>Uninstall</button>`;
    if (err) actions = installBtn + (info.installed ? uninstallBtn : "");
    else if (info.installed) actions = uninstallBtn;
    else actions = installBtn;
  }
  const progressHidden = err || busy ? "" : "lego-hidden";
  const progressMsg = err || (busy ? humanizeDownloadProgress(job.message || "Starting…") : "");
  const spinnerHidden = err || !busy ? "lego-hidden" : "";
  const progressError = err ? "is-error" : "";
  return `
    <p class="lego-style-muted settings-acc-hint">${escapeHtml(hint)}</p>
    <div class="settings-pack-progress ${progressHidden} ${progressError}" data-progress-for="vllm">
      <span class="settings-progress-spinner ${spinnerHidden}" aria-hidden="true"></span>
      <p class="settings-progress-msg lego-style-muted">${escapeHtml(progressMsg)}</p>
    </div>
    <div class="settings-pack-actions">${actions}</div>
  `;
}

function renderModels() {
  const list = ui.modelsList();
  if (!list) return;

  const hadAccordion = Boolean(list.querySelector(".lego-accordion"));
  const currentOpen = list.querySelector(
    ".lego-accordion-item.lego-accordion-open > .lego-accordion-panel:not(.lego-hidden)",
  )?.id;
  let openPanel;
  if (!hadAccordion) {
    openPanel = state.modelsAccordionOpen || "settings-models-ocr";
  } else {
    openPanel = currentOpen || null;
  }
  state.modelsAccordionOpen = openPanel;

  const packs = state.models;
  const open = openPanel === "settings-models-ocr";
  const openVllm = openPanel === "settings-models-vllm";
  const badge = sectionBusyBadge(packs) || sectionInstallBadge(packs);
  const body = packs.length
    ? packs.map(renderPackHtml).join("")
    : `<p class="lego-style-muted">No OCR packs registered.</p>`;
  const vllm = state.vllm;
  const vllmInfo = vllm ? vllmBadge(vllm) : null;
  const vllmItem = vllm
    ? `
      <div class="lego-accordion-item${openVllm ? " lego-accordion-open" : ""}">
        <button type="button" class="lego-accordion-trigger" aria-expanded="${openVllm}" aria-controls="settings-models-vllm" id="settings-models-vllm-btn">
          <span class="settings-acc-label">vLLM (for speed and efficiency)</span>
          <span class="settings-pack-pill settings-acc-badge ${vllmInfo.tone}">${vllmInfo.label}</span>
        </button>
        <div class="lego-accordion-panel${openVllm ? "" : " lego-hidden"}" id="settings-models-vllm" role="region" aria-labelledby="settings-models-vllm-btn">
          ${renderVllmInner(vllm)}
        </div>
      </div>`
    : "";

  list.innerHTML = `
    <div class="lego-accordion lego-style-accordion lego-accordion-exclusive settings-models-accordion">
      <div class="lego-accordion-item${open ? " lego-accordion-open" : ""}">
        <button type="button" class="lego-accordion-trigger" aria-expanded="${open}" aria-controls="settings-models-ocr" id="settings-models-ocr-btn">
          <span class="settings-acc-label">OCR Models (only one required)</span>
          <span class="settings-pack-pill settings-acc-badge ${badge.tone}">${badge.label}</span>
        </button>
        <div class="lego-accordion-panel${open ? "" : " lego-hidden"}" id="settings-models-ocr" role="region" aria-labelledby="settings-models-ocr-btn">
          <p class="lego-style-muted settings-acc-hint">Pick any one LightOnOCR pack. Recommended is enough for most books.</p>
          <div class="settings-models-list-inner">${body}</div>
        </div>
      </div>
      ${vllmItem}
    </div>
  `;

  // Re-apply live job messages after DOM rebuild
  for (const [packId, job] of Object.entries(state.jobs)) {
    if (!job) continue;
    setPackProgress(packId, {
      visible: true,
      message: job.message || (job.action === "uninstall" ? "Removing…" : "Starting…"),
      spinning: true,
    });
  }
  for (const [packId, err] of Object.entries(state.packErrors)) {
    setPackProgress(packId, { visible: true, message: "", error: err, spinning: false });
  }
}

function syncEngineTab() {
  const select = ui.ocrSelect();
  if (select) {
    const installed = state.models.filter((m) => m.installed);
    select.innerHTML = "";
    for (const pack of installed.length ? installed : state.models) {
      const opt = document.createElement("option");
      opt.value = pack.id;
      opt.textContent = pack.label + (pack.installed ? "" : " (not installed)");
      opt.disabled = !pack.installed;
      select.appendChild(opt);
    }
    const current = state.inference?.ocr_pack_id || ESSENTIAL_ID;
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }
  if (ui.tempInput() && state.inference) {
    ui.tempInput().value = String(state.inference.temperature ?? 0.2);
  }
  if (ui.tokensInput() && state.inference) {
    ui.tokensInput().value = String(state.inference.max_output_tokens ?? 2048);
  }
}

async function refreshSettingsData() {
  try {
    const [models, status, inference, vllm] = await Promise.all([
      fetchModels(),
      fetchModelsStatus(),
      fetchInferenceSettings(),
      fetchVllm(),
    ]);
    state.models = models;
    state.status = status;
    state.inference = inference;
    state.vllm = vllm;
    const wasGated = state.gateRequired;
    state.gateRequired = !status.ready;
    renderModels();
    syncEngineTab();
    syncGateChrome();
    if (wasGated !== state.gateRequired) state.onReadyChange?.(status.ready);
  } catch (err) {
    console.error(err);
  }
}

async function pollJob(packId, jobId, action = "install") {
  state.jobs[packId] = { id: jobId, action, message: action === "uninstall" ? "Removing…" : "Starting…" };
  delete state.packErrors[packId];
  renderModels();
  setPackProgress(packId, {
    visible: true,
    message: state.jobs[packId].message,
    spinning: true,
  });

  while (true) {
    const job = await fetchModelJob(jobId);
    state.jobs[packId] = {
      id: jobId,
      action: job.action || action,
      message: job.message || "",
    };
    setPackProgress(packId, {
      visible: true,
      message:
        (job.action || action) === "uninstall"
          ? job.message || "Removing…"
          : job.message || "Downloading…",
      error: job.status === "error" ? job.error || job.message : null,
      spinning: job.status === "running" || job.status === "queued",
    });
    // Refresh section badge while keeping progress text
    const badge = document.querySelector("#settings-models-ocr-btn .settings-acc-badge");
    if (badge) {
      const packs = state.models;
      const info = sectionBusyBadge(packs) || sectionInstallBadge(packs);
      badge.className = `settings-pack-pill settings-acc-badge ${info.tone}`;
      badge.textContent = info.label;
    }
    if (job.status === "done" || job.status === "error") {
      delete state.jobs[packId];
      if (job.status === "error") {
        state.packErrors[packId] =
          job.error || job.message || ((job.action || action) === "uninstall" ? "Uninstall failed" : "Install failed");
      } else {
        delete state.packErrors[packId];
      }
      await refreshSettingsData();
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function pollVllm(jobId, action = "install") {
  state.vllmJob = { id: jobId, action, message: action === "uninstall" ? "Removing…" : "Starting…" };
  state.vllmError = null;
  renderModels();
  setPackProgress("vllm", { visible: true, message: state.vllmJob.message, spinning: true });

  while (true) {
    const job = await fetchVllmJob(jobId);
    state.vllmJob = { id: jobId, action: job.action || action, message: job.message || "" };
    setPackProgress("vllm", {
      visible: true,
      message: job.message || (action === "uninstall" ? "Removing…" : "Downloading…"),
      error: job.status === "error" ? job.error || job.message : null,
      spinning: job.status === "running" || job.status === "queued",
    });
    const badge = document.querySelector("#settings-models-vllm-btn .settings-acc-badge");
    if (badge) {
      const info = vllmBadge(state.vllm);
      badge.className = `settings-pack-pill settings-acc-badge ${info.tone}`;
      badge.textContent = info.label;
    }
    if (job.status === "done" || job.status === "error") {
      state.vllmJob = null;
      if (job.status === "error") state.vllmError = job.error || job.message || "vLLM install failed";
      else state.vllmError = null;
      await refreshSettingsData();
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function onVllmInstall() {
  if (state.vllmJob) return;
  try {
    state.vllmError = null;
    const job = await installVllm();
    await pollVllm(job.id, "install");
  } catch (err) {
    state.vllmError = err.message || String(err);
    state.vllmJob = null;
    renderModels();
  }
}

async function onVllmUninstall() {
  if (state.vllmJob) return;
  if (!window.confirm("Remove the vLLM runtime (about 6 GB)? OCR will use Transformers until you install it again.")) {
    return;
  }
  try {
    state.vllmError = null;
    const job = await uninstallVllm();
    await pollVllm(job.id, "uninstall");
  } catch (err) {
    state.vllmError = err.message || String(err);
    state.vllmJob = null;
    renderModels();
  }
}

async function onInstall(packId) {
  if (!packId || state.jobs[packId]) return;
  try {
    delete state.packErrors[packId];
    const job = await installModelPack(packId);
    await pollJob(packId, job.id, "install");
  } catch (err) {
    state.packErrors[packId] = err.message || String(err);
    delete state.jobs[packId];
    renderModels();
  }
}

async function onUninstall(packId) {
  if (!packId || state.jobs[packId]) return;
  if (!window.confirm(`Remove model pack “${packId}”? You can reinstall it later.`)) return;
  try {
    delete state.packErrors[packId];
    const job = await uninstallModelPack(packId);
    await pollJob(packId, job.id, "uninstall");
  } catch (err) {
    state.packErrors[packId] = err.message || String(err);
    delete state.jobs[packId];
    renderModels();
  }
}

async function persistEngine() {
  const payload = {
    ocr_pack_id: ui.ocrSelect()?.value || ESSENTIAL_ID,
    temperature: Number(ui.tempInput()?.value || 0.2),
    max_output_tokens: Number(ui.tokensInput()?.value || 2048),
  };
  state.inference = await saveInferenceSettings(payload);
}

export async function initSettings({ onReadyChange } = {}) {
  state.onReadyChange = onReadyChange || null;

  ui.modelsList()?.addEventListener("click", (ev) => {
    if (ev.target?.closest?.(".settings-vllm-install")) {
      void onVllmInstall();
      return;
    }
    if (ev.target?.closest?.(".settings-vllm-uninstall")) {
      void onVllmUninstall();
      return;
    }
    const installId = ev.target?.closest?.(".settings-pack-install")?.getAttribute("data-pack-id");
    const uninstallId = ev.target?.closest?.(".settings-pack-uninstall")?.getAttribute("data-pack-id");
    if (installId) void onInstall(installId);
    if (uninstallId) void onUninstall(uninstallId);
  });

  const bindColor = (input, swatch, hex, key) => {
    input?.addEventListener("input", () => {
      const value = input.value;
      if (swatch) swatch.style.backgroundColor = value;
      if (hex) hex.textContent = value;
      applyTheme({ [key]: value }, { reapply: true });
    });
  };
  bindColor(ui.primaryColor(), ui.primarySwatch(), ui.primaryHex(), "primary");
  bindColor(ui.secondaryColor(), ui.secondarySwatch(), ui.secondaryHex(), "secondary");

  ui.resetColorsBtn()?.addEventListener("click", () => {
    applyTheme({ primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY, mode: DEFAULT_MODE }, { reapply: true });
    syncGeneralTab();
  });

  ui.darkToggle()?.addEventListener("change", () => {
    applyTheme({ mode: ui.darkToggle().checked ? "dark" : "light" }, { reapply: true });
    syncGeneralTab();
  });

  ui.ocrSelect()?.addEventListener("change", () => void persistEngine().catch(console.error));
  ui.tempInput()?.addEventListener("change", () => void persistEngine().catch(console.error));
  ui.tokensInput()?.addEventListener("change", () => void persistEngine().catch(console.error));

  document.getElementById("settings-open-btn")?.addEventListener("click", () => openSettings());
  ui.closeBtn()?.addEventListener("click", () => closeSettings());
  ui.doneBtn()?.addEventListener("click", () => closeSettings());

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !state.gateRequired) return;
      event.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!state.gateRequired) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.id === "settings-modal" ||
        target.closest?.("[data-lego-hide='settings-modal']")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  try {
    await fetchHealth();
  } catch {
    // server may still be warming
  }
  await refreshSettingsData();
  if (state.gateRequired) openSettings("models");
}
