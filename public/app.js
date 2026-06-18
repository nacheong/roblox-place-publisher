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
  contentType: document.querySelector("#contentType"),
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
  contentTypeText: document.querySelector("#contentTypeText"),
  targetText: document.querySelector("#targetText"),
  curlPreview: document.querySelector("#curlPreview"),
  responseEmpty: document.querySelector("#responseEmpty"),
  responseOutput: document.querySelector("#responseOutput"),
  dashboardLink: document.querySelector("#dashboardLink")
};

let selectedFile = null;
let isPublishing = false;
let isFetchingPlaces = false;
let discoveredPlaces = [];
let selectedPlaceIds = new Set();
let lastFetchedUniverseId = "";

function getVersionType() {
  return document.querySelector("input[name='versionType']:checked")?.value || "Published";
}

function inferContentType(file) {
  if (!file) {
    return "";
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".rbxlx")) {
    return "application/xml";
  }

  if (name.endsWith(".rbxl")) {
    return "application/octet-stream";
  }

  return "";
}

function getEffectiveContentType() {
  return els.contentType.value === "auto" ? inferContentType(selectedFile) : els.contentType.value;
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

  const versionType = encodeURIComponent(getVersionType());
  return `https://apis.roblox.com/universes/v1/${universeId}/places/${placeId}/versions?versionType=${versionType}`;
}

function buildLocalPublishUrl(placeId) {
  const params = new URLSearchParams({
    universeId: els.universeId.value.trim(),
    placeId,
    versionType: getVersionType(),
    contentType: getEffectiveContentType()
  });

  return `/api/publish?${params.toString()}`;
}

function buildCurl() {
  const targets = getPublishTargets();
  const endpoint = buildEndpoint() || "https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published";
  const contentType = getEffectiveContentType() || "application/octet-stream";
  const fileName = selectedFile?.name || "place.rbxl";
  const prefix = targets.length > 1 ? `# Repeat for selected Place IDs: ${targets.join(", ")}\n` : "";

  return `${prefix}${[
    `curl --location --request POST "${endpoint}" \\`,
    `  --header "x-api-key: $ROBLOX_API_KEY" \\`,
    `  --header "Content-Type: ${contentType}" \\`,
    `  --data-binary "@${fileName}"`
  ].join("\n")}`;
}

function saveSettings() {
  const rememberIds = els.rememberIds.checked;
  const rememberToken = els.rememberToken.checked;

  if (!rememberIds && !rememberToken) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const settings = {
    versionType: getVersionType(),
    contentType: els.contentType.value,
    rememberIds,
    rememberToken
  };

  if (rememberIds) {
    settings.universeId = els.universeId.value.trim();
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
    els.universeId.value = settings.universeId || "";
    els.placeId.value = settings.placeId || "";
    els.contentType.value = settings.contentType || "auto";
    els.rememberIds.checked = Boolean(settings.rememberIds);
    els.rememberToken.checked = Boolean(settings.rememberToken);

    if (settings.rememberToken) {
      els.apiKey.value = settings.apiKey || "";
    }

    const versionInput = document.querySelector(`input[name='versionType'][value='${settings.versionType || "Published"}']`);
    if (versionInput) {
      versionInput.checked = true;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setStatus(text, tone = "neutral") {
  els.statusPill.textContent = text;
  els.statusPill.className = `status-pill ${tone}`;
}

function setResponse(payload, tone) {
  els.responseEmpty.hidden = true;
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

  for (const place of discoveredPlaces) {
    const option = document.createElement("label");
    option.className = "place-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = place.id;
    checkbox.checked = selectedPlaceIds.has(place.id);
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
    id.textContent = `Place ID ${place.id}`;

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
    selectedPlaceIds = new Set();
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
  const contentType = getEffectiveContentType();
  const targets = getPublishTargets();

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

  if (!selectedFile) {
    errors.push("Select a .rbxl or .rbxlx file.");
  }

  if (selectedFile && !contentType) {
    errors.push("Choose a content type for this file.");
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
  const contentType = getEffectiveContentType();
  const targets = getPublishTargets();

  els.endpointText.textContent = endpoint.includes("{selectedPlaceId}") ? "Multiple selected place endpoints" : endpoint || "Waiting for IDs";
  els.contentTypeText.textContent = contentType || "Waiting for file";
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
    els.fileMeta.textContent = ".rbxl or .rbxlx";
    validate(false);
    return;
  }

  const inferredType = inferContentType(selectedFile);
  els.fileTitle.textContent = selectedFile.name;
  els.fileMeta.textContent = `${formatBytes(selectedFile.size)}${inferredType ? ` - ${inferredType}` : ""}`;
  validate(false);
}

async function publishPlace() {
  const errors = validate(true);
  const targets = getPublishTargets();

  if (errors.length > 0 || !selectedFile || targets.length === 0) {
    setStatus("Check fields", "warning");
    return;
  }

  isPublishing = true;
  els.publishButton.disabled = true;
  setStatus("Publishing", "warning");
  setResponse(`Uploading to ${targets.length} place${targets.length === 1 ? "" : "s"}...`, "neutral");

  const results = [];

  for (const [index, placeId] of targets.entries()) {
    setStatus(`${index + 1}/${targets.length}`, "warning");

    try {
      const response = await fetch(buildLocalPublishUrl(placeId), {
        method: "POST",
        headers: {
          "x-api-key": els.apiKey.value.trim(),
          "content-type": getEffectiveContentType()
        },
        body: selectedFile
      });

      const payload = await response.json();
      const versionNumber = payload.body?.versionNumber ?? payload.body;

      results.push({
        placeId,
        ok: response.ok && payload.ok,
        status: payload.status || response.status,
        versionNumber,
        response: payload
      });
    } catch (error) {
      results.push({
        placeId,
        ok: false,
        message: error instanceof Error ? error.message : "Publish failed."
      });
    }
  }

  const succeeded = results.filter((result) => result.ok).length;
  const allOk = succeeded === results.length;

  setStatus(allOk ? `${succeeded} published` : `${succeeded}/${results.length} ok`, allOk ? "success" : "error");
  setResponse({
    ok: allOk,
    universeId: els.universeId.value.trim(),
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
  els.fileInput.value = "";
  els.responseOutput.hidden = true;
  els.responseEmpty.hidden = false;
  els.responseOutput.textContent = "";
  els.responseOutput.style.borderColor = "";
  setStatus("Ready", "neutral");
  localStorage.removeItem(STORAGE_KEY);
  clearPlaces();
  updateFile(null);
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

  [els.apiKey, els.universeId, els.placeId, els.contentType, els.rememberIds, els.rememberToken].forEach((element) => {
    element.addEventListener("input", () => {
      if (element === els.universeId && lastFetchedUniverseId && els.universeId.value.trim() !== lastFetchedUniverseId) {
        clearPlaces("Universe changed. Find places again.");
      }

      validate(false);
    });
    element.addEventListener("change", () => validate(false));
  });

  document.querySelectorAll("input[name='versionType']").forEach((element) => {
    element.addEventListener("change", () => validate(false));
  });
}

loadSettings();
bindEvents();
renderPlaces();
updatePreview();
validate(false);
window.addEventListener("load", () => window.lucide?.createIcons());
