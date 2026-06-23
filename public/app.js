const STORAGE_KEY = "roblox-place-publisher.settings.v1";

const els = {
  form: document.querySelector("#publishForm"),
  apiKey: document.querySelector("#apiKey"),
  toggleKey: document.querySelector("#toggleKey"),
  universeId: document.querySelector("#universeId"),
  placeId: document.querySelector("#placeId"),
  fetchPlaces: document.querySelector("#fetchPlaces"),
  placesHint: document.querySelector("#placesHint"),
  placesList: document.querySelector("#placesList"),
  selectAllPlaces: document.querySelector("#selectAllPlaces"),
  sourceHint: document.querySelector("#sourceHint"),
  fileInput: document.querySelector("#placeFile"),
  fileZone: document.querySelector("#fileZone"),
  fileTitle: document.querySelector("#fileTitle"),
  fileMeta: document.querySelector("#fileMeta"),
  rememberIds: document.querySelector("#rememberIds"),
  rememberToken: document.querySelector("#rememberToken"),
  formErrors: document.querySelector("#formErrors"),
  publishButton: document.querySelector("#publishButton"),
  copyCurl: document.querySelector("#copyCurl"),
  resetForm: document.querySelector("#resetForm"),
  statusPill: document.querySelector("#statusPill"),
  endpointText: document.querySelector("#endpointText"),
  fileText: document.querySelector("#fileText"),
  sourceText: document.querySelector("#sourceText"),
  targetText: document.querySelector("#targetText"),
  curlPreview: document.querySelector("#curlPreview"),
  responseEmpty: document.querySelector("#responseEmpty"),
  responseBrief: document.querySelector("#responseBrief"),
  responseOutput: document.querySelector("#responseOutput"),
  dashboardLink: document.querySelector("#dashboardLink")
};

let selectedFile = null;
let isPublishing = false;
let isFetchingPlaces = false;
let discoveredPlaces = [];
let selectedPlaceIds = new Set();
let lastFetchedUniverseId = "";
let savedPlaceSelections = {};
let savedPlacesByUniverse = {};

function getVersionType() {
  return document.querySelector("input[name='versionType']:checked")?.value || "published";
}

function getPublishSource() {
  return document.querySelector("input[name='publishSource']:checked")?.value || "asset";
}

function getVersionAction() {
  return getVersionType() === "saved" ? "saved" : "published";
}

function isRbxlFile(file) {
  if (!file) {
    return false;
  }

  return file.name.toLowerCase().endsWith(".rbxl");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getCachedSelection(universeId) {
  return Array.isArray(savedPlaceSelections[universeId])
    ? savedPlaceSelections[universeId].map(String)
    : [];
}

function rememberCurrentPlaces() {
  const universeId = els.universeId.value.trim();

  if (!/^\d+$/.test(universeId) || discoveredPlaces.length === 0) {
    return;
  }

  savedPlacesByUniverse[universeId] = discoveredPlaces;
  savedPlaceSelections[universeId] = Array.from(selectedPlaceIds);
}

function restoreCachedPlaces(universeId) {
  if (!/^\d+$/.test(universeId)) {
    return false;
  }

  const cachedPlaces = Array.isArray(savedPlacesByUniverse[universeId])
    ? savedPlacesByUniverse[universeId]
    : [];

  if (cachedPlaces.length === 0) {
    return false;
  }

  discoveredPlaces = cachedPlaces;
  const availableIds = new Set(discoveredPlaces.map((place) => String(place.id)));
  selectedPlaceIds = new Set(getCachedSelection(universeId).filter((placeId) => availableIds.has(placeId)));
  lastFetchedUniverseId = universeId;
  renderPlaces();
  return true;
}

function getPublishTargets() {
  const selected = Array.from(selectedPlaceIds);

  if (selected.length > 0) {
    return selected;
  }

  const manualPlaceId = els.placeId.value.trim();
  return manualPlaceId ? [manualPlaceId] : [];
}

function getPreviewPlaceId() {
  const targets = getPublishTargets();

  if (targets.length === 1) {
    return targets[0];
  }

  if (targets.length > 1) {
    return "{selectedPlaceId}";
  }

  return els.placeId.value.trim() || "{placeId}";
}

function buildEndpoint(placeId = getPreviewPlaceId()) {
  const universeId = els.universeId.value.trim();

  if (!universeId || !placeId) {
    return "";
  }

  if (getPublishSource() === "asset") {
    return `Roblox Asset Delivery -> rbxcloud experience publish for ${placeId}`;
  }

  return `rbxcloud experience publish --universe-id ${universeId} --place-id ${placeId}`;
}

function buildAssetPublishUrl(placeId) {
  const params = new URLSearchParams({
    universeId: els.universeId.value.trim(),
    placeId,
    versionType: getVersionType()
  });

  return `/api/publish-asset?${params.toString()}`;
}

function buildLocalPublishUrl(placeId) {
  const params = new URLSearchParams({
    universeId: els.universeId.value.trim(),
    placeId,
    versionType: getVersionType(),
    filename: selectedFile?.name || "place.rbxl"
  });

  return `/api/publish?${params.toString()}`;
}

function buildCurl() {
  const targets = getPublishTargets();
  const previewPlaceId = getPreviewPlaceId();
  const fileName = selectedFile?.name || "place.rbxl";
  const universeId = els.universeId.value.trim() || "{universeId}";
  const placeId = previewPlaceId || "{placeId}";
  const versionType = getVersionType();
  const prefix = targets.length > 1 ? `# Repeat for selected Place IDs: ${targets.join(", ")}\n` : "";

  if (getPublishSource() === "asset") {
    return `${prefix}${[
      "# App no-file workflow:",
      "# The local server downloads the current Roblox place file through Asset Delivery, then runs:",
      "rbxcloud experience publish \\",
      "  --filename \"<downloaded-place>.rbxl\" \\",
      `  --place-id ${placeId} \\`,
      `  --universe-id ${universeId} \\`,
      `  --version-type ${versionType} \\`,
      "  --api-key \"$ROBLOX_API_KEY\""
    ].join("\n")}`;
  }

  return `${prefix}${[
    "rbxcloud experience publish \\",
    `  --filename "${fileName}" \\`,
    `  --place-id ${placeId} \\`,
    `  --universe-id ${universeId} \\`,
    `  --version-type ${versionType} \\`,
    `  --api-key "$ROBLOX_API_KEY"`
  ].join("\n")}`;
}

function saveSettings() {
  const rememberIds = els.rememberIds.checked;
  const rememberToken = els.rememberToken.checked;
  const currentUniverseId = els.universeId.value.trim();
  rememberCurrentPlaces();
  const hasSavedPlaces = Object.keys(savedPlacesByUniverse).length > 0 || Object.keys(savedPlaceSelections).length > 0;

  if (!rememberIds && !rememberToken && !hasSavedPlaces) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const settings = {
    settingsVersion: 6,
    versionType: getVersionType(),
    publishSource: getPublishSource(),
    rememberIds,
    rememberToken,
    placeSelectionsByUniverse: savedPlaceSelections,
    placesByUniverse: savedPlacesByUniverse
  };

  if (/^\d+$/.test(currentUniverseId)) {
    settings.lastUniverseId = currentUniverseId;
  }

  if (rememberIds) {
    settings.universeId = currentUniverseId;
    settings.placeId = els.placeId.value.trim();
  }

  if (rememberToken) {
    settings.apiKey = els.apiKey.value.trim();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const settings = JSON.parse(raw);
    savedPlaceSelections = asPlainObject(settings.placeSelectionsByUniverse);
    savedPlacesByUniverse = asPlainObject(settings.placesByUniverse);
    els.universeId.value = settings.universeId || settings.lastUniverseId || "";
    els.placeId.value = settings.rememberIds ? settings.placeId || "" : "";
    els.rememberIds.checked = Boolean(settings.rememberIds);
    els.rememberToken.checked = Boolean(settings.rememberToken);

    if (settings.rememberToken) {
      els.apiKey.value = settings.apiKey || "";
    }

    const versionInput = document.querySelector(`input[name='versionType'][value='${settings.versionType || "published"}']`);
    if (versionInput) {
      versionInput.checked = true;
    }

    const sourceInput = document.querySelector(`input[name='publishSource'][value='${settings.publishSource || "asset"}']`);
    if (sourceInput) {
      sourceInput.checked = true;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setStatus(text, tone = "neutral") {
  els.statusPill.textContent = text;
  els.statusPill.className = `status-pill ${tone}`;
}

function getPlaceLabel(placeId) {
  const place = discoveredPlaces.find((candidate) => candidate.id === String(placeId));
  return place ? place.name : `Place ${placeId}`;
}

function detailText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(detailText).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return detailText(value.message)
      || detailText(value.error)
      || detailText(value.errors)
      || detailText(value.details)
      || detailText(value.statusText);
  }

  return String(value);
}

function extractPayloadMessage(payload) {
  const parts = [
    payload?.message,
    payload?.statusText,
    payload?.body?.message,
    payload?.body?.error,
    payload?.body?.errors,
    payload?.body?.details
  ].map(detailText).filter(Boolean);

  return Array.from(new Set(parts)).join(" ");
}

function getResultStatus(result) {
  return Number(result.status || result.response?.status || result.response?.body?.status || 0);
}

function getDebugFilePath(result) {
  return result?.debugFile
    || result?.latestDebugFile
    || result?.response?.debugFile
    || result?.response?.latestDebugFile
    || "";
}

function interpretResult(result) {
  if (result.ok) {
    const publishedVersion = result.versionNumber ?? result.response?.body?.versionNumber;
    const sourceVersion = result.response?.sourceVersionNumber;
    const detail = publishedVersion
      ? `Roblox accepted it as version ${publishedVersion}${sourceVersion ? ` from saved version ${sourceVersion}` : ""}.`
      : "Roblox accepted the publish request.";

    return {
      title: "Published",
      detail
    };
  }

  const status = getResultStatus(result);
  const message = [result.message, extractPayloadMessage(result.response || {})].filter(Boolean).join(" ");
  const lowerMessage = message.toLowerCase();

  if (status === 401) {
    return {
      title: "API key rejected",
      detail: "Roblox did not accept the API key. Recheck the token text, expiration, and any IP restrictions."
    };
  }

  if (status === 403 && lowerMessage.includes("legacy-asset")) {
    return {
      title: "Missing legacy-asset:manage",
      detail: "The key cannot download the place asset bytes. Add legacy-asset:manage, then retry."
    };
  }

  if (status === 403) {
    return {
      title: "Permission denied",
      detail: "Roblox blocked access to this place or universe. Check key scopes, creator ownership, and universe permissions."
    };
  }

  if (status === 409) {
    return {
      title: "Conflict",
      detail: message || "Roblox reported a conflict while publishing this file."
    };
  }

  if (status === 404) {
    return {
      title: "Not found",
      detail: "Roblox could not find that place/universe combination for this key. Check IDs and access."
    };
  }

  if (status === 429) {
    return {
      title: "Rate limited",
      detail: "Roblox is throttling publish requests. Wait a minute, then retry a smaller batch."
    };
  }

  if (status >= 500) {
    return {
      title: "Roblox service error",
      detail: message || "The request reached Roblox, but the service did not complete it."
    };
  }

  if (status === 400) {
    return {
      title: "Request rejected",
      detail: message || "Roblox rejected the request format or one of the IDs."
    };
  }

  return {
    title: status ? `HTTP ${status}` : "Publish failed",
    detail: message || "No detailed error was returned."
  };
}

function findCommonFailure(results) {
  const failures = results.filter((result) => !result.ok);
  const counts = new Map();

  for (const result of failures) {
    const interpretation = interpretResult(result);
    const key = interpretation.title;
    const current = counts.get(key);

    counts.set(key, {
      ...interpretation,
      count: (current?.count || 0) + 1,
      details: Array.from(new Set([...(current?.details || []), interpretation.detail]))
    });
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0] || null;
}

function formatFailureSummary(failure) {
  const placeText = `${failure.count} place${failure.count === 1 ? "" : "s"}`;
  const example = failure.details?.length > 1 ? ` Example: ${failure.detail}` : "";

  return `${placeText}: ${failure.title}. ${failure.detail}${example}`;
}

function renderResponseBrief(payload, tone) {
  els.responseBrief.replaceChildren();

  if (!payload || typeof payload === "string") {
    els.responseBrief.hidden = true;
    return;
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const summary = document.createElement("div");
  summary.className = `response-summary ${tone || "neutral"}`;

  const heading = document.createElement("h3");
  const copy = document.createElement("p");

  if (results.length > 0) {
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    const commonFailure = findCommonFailure(results);
    const versionAction = getVersionAction();

    heading.textContent = `${succeeded} of ${results.length} places ${versionAction}`;
    copy.textContent = failed === 0
      ? "Every selected place returned a successful response."
      : commonFailure
        ? formatFailureSummary(commonFailure)
        : "One or more places failed. Check the per-place grid below.";

    summary.append(heading, copy);

    const grid = document.createElement("div");
    grid.className = "publish-result-grid";

    for (const result of results) {
      const interpretation = interpretResult(result);
      const item = document.createElement("div");
      item.className = `publish-result ${result.ok ? "success" : "error"}`;

      const title = document.createElement("strong");
      title.textContent = getPlaceLabel(result.placeId);

      const meta = document.createElement("span");
      meta.textContent = result.ok ? interpretation.detail : `${interpretation.title}: ${interpretation.detail}`;

      const id = document.createElement("code");
      id.textContent = String(result.placeId);

      const debugFile = getDebugFilePath(result);

      item.append(title, meta, id);

      if (debugFile) {
        const debug = document.createElement("code");
        debug.className = "debug-path";
        debug.textContent = debugFile;
        item.append(debug);
      }

      grid.append(item);
    }

    els.responseBrief.append(summary, grid);
    els.responseBrief.hidden = false;
    return;
  }

  const interpretation = interpretResult({
    ok: Boolean(payload.ok),
    status: payload.status,
    response: payload,
    message: payload.message
  });

  heading.textContent = payload.ok ? "Request accepted" : interpretation.title;
  copy.textContent = payload.ok ? "Roblox returned a successful response." : interpretation.detail;
  summary.append(heading, copy);
  els.responseBrief.append(summary);
  els.responseBrief.hidden = false;
}

function setResponse(payload, tone) {
  els.responseEmpty.hidden = true;
  renderResponseBrief(payload, tone);
  els.responseOutput.hidden = false;
  els.responseOutput.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

  if (tone === "success") {
    els.responseOutput.style.borderColor = "#a9dec9";
  } else if (tone === "error") {
    els.responseOutput.style.borderColor = "#f3b8b2";
  } else {
    els.responseOutput.style.borderColor = "";
  }
}

function updatePublishSourceUi() {
  const source = getPublishSource();
  const isFileSource = source === "file";

  els.fileZone.classList.toggle("hidden", !isFileSource);

  if (isFileSource) {
    els.sourceHint.textContent = "Fallback: upload an explicit .rbxl file from disk.";

    if (!selectedFile) {
      els.fileMeta.textContent = ".rbxl from Studio";
    }
  } else {
    els.sourceHint.textContent = "No file picker: downloads the current place file from Roblox Asset Delivery, then republishes it with rbxcloud.";
    els.fileMeta.textContent = "Asset Delivery source selected.";
  }
}

function clearPlaces(message = "No places loaded.") {
  discoveredPlaces = [];
  selectedPlaceIds = new Set();
  lastFetchedUniverseId = "";
  renderPlaces(message);
}

function renderPlaces(emptyMessage = "No places loaded.") {
  els.placesList.replaceChildren();
  els.placesList.classList.toggle("empty", discoveredPlaces.length === 0);
  els.placesList.classList.remove("loading");

  if (discoveredPlaces.length === 0) {
    const empty = document.createElement("span");
    empty.textContent = emptyMessage;
    els.placesList.append(empty);
    els.selectAllPlaces.checked = false;
    els.selectAllPlaces.disabled = true;
    els.placesHint.textContent = "Find places from the Universe ID, then choose targets.";
    validate(false);
    return;
  }

  els.selectAllPlaces.disabled = false;
  els.selectAllPlaces.checked = selectedPlaceIds.size === discoveredPlaces.length;
  els.placesHint.textContent = `${discoveredPlaces.length} place${discoveredPlaces.length === 1 ? "" : "s"} found. ${selectedPlaceIds.size} selected.`;

  const orderedPlaces = [...discoveredPlaces].sort((a, b) => {
    const aSelected = selectedPlaceIds.has(a.id);
    const bSelected = selectedPlaceIds.has(b.id);

    if (aSelected !== bSelected) {
      return aSelected ? -1 : 1;
    }

    return 0;
  });

  for (const place of orderedPlaces) {
    const isSelected = selectedPlaceIds.has(place.id);
    const option = document.createElement("label");
    option.className = `place-option${isSelected ? " selected" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = place.id;
    checkbox.checked = isSelected;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedPlaceIds.add(place.id);
      } else {
        selectedPlaceIds.delete(place.id);
      }

      renderPlaces();
      validate(false);
    });

    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "place-name";
    name.textContent = place.name;

    const id = document.createElement("div");
    id.className = "place-id";
    id.textContent = place.id;

    copy.append(name, id);
    option.append(checkbox, copy);

    if (place.isRootPlace) {
      const rootBadge = document.createElement("span");
      rootBadge.className = "root-badge";
      rootBadge.textContent = "Start";
      option.append(rootBadge);
    }

    els.placesList.append(option);
  }
}

function setPlacesLoading() {
  els.placesList.replaceChildren();
  els.placesList.classList.add("loading");
  els.placesList.classList.remove("empty");
  const loading = document.createElement("span");
  loading.textContent = "Finding places...";
  els.placesList.append(loading);
}

async function fetchPlaces() {
  const universeId = els.universeId.value.trim();

  if (!/^\d+$/.test(universeId)) {
    clearPlaces("Enter a numeric Universe ID first.");
    setStatus("Check Universe ID", "warning");
    return;
  }

  isFetchingPlaces = true;
  els.fetchPlaces.disabled = true;
  els.selectAllPlaces.disabled = true;
  setStatus("Finding places", "warning");
  setPlacesLoading();

  try {
    const response = await fetch(`/api/places?universeId=${encodeURIComponent(universeId)}`, {
      headers: els.apiKey.value.trim() ? { "x-api-key": els.apiKey.value.trim() } : {}
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      clearPlaces(payload.message || "Unable to fetch places.");
      setStatus(`HTTP ${payload.status || response.status}`, "error");
      setResponse(payload, "error");
      return;
    }

    discoveredPlaces = payload.places || [];
    const availableIds = new Set(discoveredPlaces.map((place) => String(place.id)));
    selectedPlaceIds = new Set(getCachedSelection(universeId).filter((placeId) => availableIds.has(placeId)));
    lastFetchedUniverseId = universeId;
    renderPlaces(discoveredPlaces.length === 0 ? "No places found for this universe." : undefined);
    setStatus(`${discoveredPlaces.length} found`, discoveredPlaces.length > 0 ? "success" : "warning");
  } catch (error) {
    clearPlaces("Unable to fetch places.");
    setStatus("Fetch failed", "error");
    setResponse({
      ok: false,
      message: error instanceof Error ? error.message : "Unable to fetch places."
    }, "error");
  } finally {
    isFetchingPlaces = false;
    els.fetchPlaces.disabled = false;
    validate(false);
  }
}

function validate(showErrors = false) {
  const errors = [];
  const universeId = els.universeId.value.trim();
  const manualPlaceId = els.placeId.value.trim();
  const targets = getPublishTargets();
  const isFileSource = getPublishSource() === "file";

  if (!els.apiKey.value.trim()) {
    errors.push("Enter an API key.");
  }

  if (!/^\d+$/.test(universeId)) {
    errors.push("Enter a numeric Universe ID.");
  }

  if (manualPlaceId && !/^\d+$/.test(manualPlaceId)) {
    errors.push("Manual Place ID must be numeric.");
  }

  if (targets.length === 0) {
    errors.push("Select at least one associated place or enter a manual Place ID.");
  }

  if (isFileSource && !selectedFile) {
    errors.push("Select a .rbxl file.");
  }

  if (isFileSource && selectedFile && !isRbxlFile(selectedFile)) {
    errors.push("The selected file must end in .rbxl.");
  }

  els.publishButton.disabled = errors.length > 0 || isPublishing || isFetchingPlaces;
  els.formErrors.textContent = showErrors && errors.length > 0 ? errors.join(" ") : "";
  els.formErrors.classList.toggle("visible", showErrors && errors.length > 0);

  updatePreview();
  saveSettings();

  return errors;
}

function updatePreview() {
  const endpoint = buildEndpoint();
  const targets = getPublishTargets();
  const source = getPublishSource();

  els.endpointText.textContent = endpoint.includes("{selectedPlaceId}") ? "rbxcloud workflow for selected places" : endpoint || "Waiting for IDs";
  els.fileText.textContent = source === "asset" ? "Asset Delivery" : selectedFile ? selectedFile.name : "Waiting for .rbxl";
  els.sourceText.textContent = source === "asset"
    ? "Asset Delivery copy"
    : targets.length > 1
      ? "Same .rbxl to each target"
      : "Local .rbxl file";
  els.targetText.textContent = describeTargets(targets);
  els.curlPreview.textContent = buildCurl();

  const universeId = els.universeId.value.trim();
  const dashboardPlaceId = targets.length === 1 ? targets[0] : "";
  els.dashboardLink.href = universeId && dashboardPlaceId
    ? `https://create.roblox.com/dashboard/creations/experiences/${universeId}/places/${dashboardPlaceId}/configure`
    : "https://create.roblox.com/dashboard/creations";
}

function describeTargets(targets) {
  if (targets.length === 0) {
    return "Waiting for place selection";
  }

  if (targets.length === 1) {
    const place = discoveredPlaces.find((candidate) => candidate.id === targets[0]);
    return place ? `${place.name} (${targets[0]})` : `Manual place ${targets[0]}`;
  }

  return `${targets.length} selected places`;
}

function updateFile(file) {
  selectedFile = file || null;

  if (!selectedFile) {
    els.fileTitle.textContent = "Choose a place file";
    els.fileMeta.textContent = ".rbxl from Studio";
    validate(false);
    return;
  }

  els.fileTitle.textContent = selectedFile.name;
  els.fileMeta.textContent = isRbxlFile(selectedFile)
    ? formatBytes(selectedFile.size)
    : `${formatBytes(selectedFile.size)} - not an .rbxl file`;
  validate(false);
}

async function publishPlace() {
  const errors = validate(true);
  const targets = getPublishTargets();
  const source = getPublishSource();

  if (errors.length > 0 || (source === "file" && !selectedFile) || targets.length === 0) {
    setStatus("Check fields", "warning");
    return;
  }

  isPublishing = true;
  els.publishButton.disabled = true;
  setStatus("Publishing", "warning");
  setResponse(source === "asset"
    ? `Publishing Asset Delivery copy to ${targets.length} place${targets.length === 1 ? "" : "s"} with rbxcloud...`
    : `Publishing ${selectedFile.name} to ${targets.length} place${targets.length === 1 ? "" : "s"} with rbxcloud...`, "neutral");

  const results = [];

  for (const [index, placeId] of targets.entries()) {
    setStatus(`${index + 1}/${targets.length}`, "warning");

    try {
      const headers = {
        "x-api-key": els.apiKey.value.trim()
      };
      const request = {
        method: "POST",
        headers
      };

      if (source === "file") {
        headers["content-type"] = "application/octet-stream";
        request.body = selectedFile;
      }

      const url = source === "asset" ? buildAssetPublishUrl(placeId) : buildLocalPublishUrl(placeId);
      const response = await fetch(url, request);

      const payload = await response.json();
      const versionNumber = payload.body?.versionNumber ?? payload.body;

      results.push({
        placeId,
        source,
        ok: response.ok && payload.ok,
        status: payload.status || response.status,
        versionNumber,
        response: payload
      });
    } catch (error) {
      results.push({
        placeId,
        source,
        ok: false,
        message: error instanceof Error ? error.message : "Publish failed."
      });
    }
  }

  const succeeded = results.filter((result) => result.ok).length;
  const allOk = succeeded === results.length;

  setStatus(allOk ? `${succeeded} ${getVersionAction()}` : `${succeeded}/${results.length} ok`, allOk ? "success" : "error");
  setResponse({
    ok: allOk,
    universeId: els.universeId.value.trim(),
    source,
    file: source === "file" ? selectedFile.name : null,
    versionType: getVersionType(),
    targets: results.length,
    succeeded,
    results
  }, allOk ? "success" : "error");

  isPublishing = false;
  validate(false);
}

function resetForm() {
  els.form.reset();
  selectedFile = null;
  savedPlaceSelections = {};
  savedPlacesByUniverse = {};
  els.fileInput.value = "";
  els.responseOutput.hidden = true;
  els.responseBrief.hidden = true;
  els.responseBrief.replaceChildren();
  els.responseEmpty.hidden = false;
  els.responseOutput.textContent = "";
  els.responseOutput.style.borderColor = "";
  setStatus("Ready", "neutral");
  localStorage.removeItem(STORAGE_KEY);
  clearPlaces();
  updateFile(null);
  updatePublishSourceUi();
}

function bindEvents() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    publishPlace();
  });

  els.toggleKey.addEventListener("click", () => {
    const isPassword = els.apiKey.type === "password";
    els.apiKey.type = isPassword ? "text" : "password";
    els.toggleKey.setAttribute("aria-label", isPassword ? "Hide API key" : "Show API key");
    els.toggleKey.setAttribute("title", isPassword ? "Hide API key" : "Show API key");
    els.toggleKey.innerHTML = `<i data-lucide="${isPassword ? "eye-off" : "eye"}"></i>`;
    window.lucide?.createIcons();
  });

  els.fetchPlaces.addEventListener("click", fetchPlaces);
  els.fileInput.addEventListener("change", () => updateFile(els.fileInput.files?.[0]));

  els.selectAllPlaces.addEventListener("change", () => {
    selectedPlaceIds = els.selectAllPlaces.checked
      ? new Set(discoveredPlaces.map((place) => place.id))
      : new Set();
    renderPlaces();
    validate(false);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.fileZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.fileZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.fileZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.fileZone.classList.remove("dragging");
    });
  });

  els.fileZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    els.fileInput.files = transfer.files;
    updateFile(file);
  });

  els.copyCurl.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildCurl());
      setStatus("Copied", "success");
      window.setTimeout(() => setStatus("Ready", "neutral"), 1400);
    } catch {
      setStatus("Copy failed", "error");
    }
  });

  els.resetForm.addEventListener("click", resetForm);

  [els.apiKey, els.universeId, els.placeId, els.rememberIds, els.rememberToken].forEach((element) => {
    element.addEventListener("input", () => {
      if (element === els.universeId && lastFetchedUniverseId && els.universeId.value.trim() !== lastFetchedUniverseId) {
        const universeId = els.universeId.value.trim();

        if (!restoreCachedPlaces(universeId)) {
          clearPlaces("Universe changed. Find places again.");
        }
      }

      validate(false);
    });
    element.addEventListener("change", () => validate(false));
  });

  document.querySelectorAll("input[name='versionType']").forEach((element) => {
    element.addEventListener("change", () => validate(false));
  });

  document.querySelectorAll("input[name='publishSource']").forEach((element) => {
    element.addEventListener("change", () => {
      updatePublishSourceUi();
      validate(false);
    });
  });
}

loadSettings();
bindEvents();
updatePublishSourceUi();
if (!restoreCachedPlaces(els.universeId.value.trim())) {
  renderPlaces();
}
updatePreview();
validate(false);
window.addEventListener("load", () => window.lucide?.createIcons());
