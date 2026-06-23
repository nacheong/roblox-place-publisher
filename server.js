const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");
const { indexPlacePackages, touchPlaceFile, verifyPlaceMarker } = require("./lib/place-touch.cjs");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.resolve(__dirname, "public");
const DEBUG_PLACE_DIR = path.resolve(__dirname, "debug-place-files");
const RBXCLOUD_BINARY = process.platform === "win32" ? "rbxcloud.exe" : "rbxcloud";
const VERIFY_PUBLISH_ATTEMPTS = Number(process.env.PUBLISH_VERIFY_ATTEMPTS || 4);
const VERIFY_PUBLISH_DELAY_MS = Number(process.env.PUBLISH_VERIFY_DELAY_MS || 1500);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch (error) {
    console.warn(`Unable to open browser automatically: ${error instanceof Error ? error.message : error}`);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function isPathLike(command) {
  return command.includes("/") || command.includes("\\") || path.isAbsolute(command);
}

function detailMessage(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(detailMessage).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return detailMessage(value.message)
      || detailMessage(value.error)
      || detailMessage(value.errors)
      || detailMessage(value.details)
      || detailMessage(value.statusText);
  }

  return String(value);
}

function resolveRbxcloudCommand() {
  const candidates = [
    process.env.RBXCLOUD_PATH,
    path.join(__dirname, "..", "tools", RBXCLOUD_BINARY),
    path.join(__dirname, "tools", RBXCLOUD_BINARY),
    path.join(__dirname, ".portable-cache", "rbxcloud", RBXCLOUD_BINARY),
    "rbxcloud"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isPathLike(candidate) || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function parseRbxcloudError(text) {
  const trimmed = String(text || "").trim();
  const httpLineMatch = trimmed.match(/^http\s+(\d+):\s*([\s\S]*)$/i);

  if (httpLineMatch) {
    const rawMessage = httpLineMatch[2].trim();
    const jsonMessage = parseMaybeJson(rawMessage);

    return {
      status: Number(httpLineMatch[1]),
      message: detailMessage(jsonMessage) || rawMessage
    };
  }

  const statusMatch = trimmed.match(/HttpStatusError\s*\{\s*code:\s*(\d+),\s*msg:\s*"((?:\\.|[^"])*)"/);

  if (statusMatch) {
    const rawMessage = statusMatch[2]
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
    const jsonMessage = parseMaybeJson(rawMessage);

    return {
      status: Number(statusMatch[1]),
      message: detailMessage(jsonMessage) || rawMessage
    };
  }

  return {
    status: 502,
    message: trimmed || "rbxcloud did not return an error message."
  };
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runRbxcloudPublish({ command, apiKey, universeId, placeId, versionType, filename }) {
  const args = [
    "experience",
    "publish",
    "--filename",
    filename,
    "--place-id",
    placeId,
    "--universe-id",
    universeId,
    "--version-type",
    versionType.toLowerCase()
  ];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        RBXCLOUD_API_KEY: apiKey
      },
      shell: false,
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      resolve({
        ok: false,
        status: 502,
        statusText: "rbxcloud failed",
        body: null,
        message: error instanceof Error ? error.message : "Unable to start rbxcloud."
      });
    });

    child.on("exit", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
      const stderrText = Buffer.concat(stderr).toString("utf8").trim();
      const body = parseMaybeJson(stdoutText);

      if (code === 0) {
        resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          body,
          rbxcloudExitCode: code
        });
        return;
      }

      const parsedError = parseRbxcloudError(stderrText || stdoutText);

      resolve({
        ok: false,
        status: parsedError.status,
        statusText: "rbxcloud failed",
        body: body || null,
        rbxcloudExitCode: code,
        message: parsedError.message,
        stderr: stderrText
      });
    });
  });
}

function parseMaybeJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getPlaceFileExtension(filename) {
  const extension = path.extname(filename || "").toLowerCase();
  return extension === ".rbxl" ? extension : "";
}

function timestampForFilename(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

async function saveDebugPlaceFile({ placeId, buffer, fileExtension }) {
  await fsp.mkdir(DEBUG_PLACE_DIR, { recursive: true });

  const { debugFile, latestDebugFile } = getDebugPlacePaths({ placeId, fileExtension });

  await fsp.writeFile(debugFile, buffer);

  return {
    debugFile,
    latestDebugFile
  };
}

function getDebugPlacePaths({ placeId, fileExtension }) {
  const extension = fileExtension || ".rbxl";
  const timestamp = timestampForFilename();
  const debugFile = path.join(DEBUG_PLACE_DIR, `place-${placeId}-${timestamp}${extension}`);
  const latestFile = path.join(DEBUG_PLACE_DIR, `latest-place-${placeId}${extension}`);

  return {
    debugFile,
    latestDebugFile: latestFile
  };
}

function isDebugPlaceFilename(filename) {
  return /^latest-place-\d+\.rbxl(?:\.lock)?$/.test(filename)
    || /^place-\d+-\d{8}T\d{6}Z\.rbxl(?:\.lock)?$/.test(filename);
}

async function clearDebugPlaceFiles() {
  let entries;

  try {
    entries = await fsp.readdir(DEBUG_PLACE_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        deleted: 0,
        bytes: 0,
        files: []
      };
    }

    throw error;
  }

  const files = [];
  let bytes = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !isDebugPlaceFilename(entry.name)) {
      continue;
    }

    const filePath = path.resolve(DEBUG_PLACE_DIR, entry.name);

    if (!filePath.startsWith(`${DEBUG_PLACE_DIR}${path.sep}`)) {
      throw new Error(`Refusing to delete a file outside ${DEBUG_PLACE_DIR}.`);
    }

    const stats = await fsp.stat(filePath);
    await fsp.unlink(filePath);
    bytes += stats.size;
    files.push(entry.name);
  }

  return {
    deleted: files.length,
    bytes,
    files
  };
}

function validatePublishRequest(req, searchParams) {
  const apiKey = req.headers["x-api-key"];
  const universeId = (searchParams.get("universeId") || "").trim();
  const placeId = (searchParams.get("placeId") || "").trim();
  const versionType = (searchParams.get("versionType") || "published").trim().toLowerCase();
  const originalFilename = (searchParams.get("filename") || "").trim();
  const fileExtension = getPlaceFileExtension(originalFilename);
  const contentLength = req.headers["content-length"];
  const packageOptions = parsePackagePublishHeaders(req);

  const errors = [];

  if (!apiKey || Array.isArray(apiKey)) {
    errors.push("API key is required.");
  }

  if (!/^\d+$/.test(universeId)) {
    errors.push("Universe ID must be a number.");
  }

  if (!/^\d+$/.test(placeId)) {
    errors.push("Place ID must be a number.");
  }

  if (!["published", "saved"].includes(versionType)) {
    errors.push("Version type must be published or saved.");
  }

  if (!fileExtension) {
    errors.push("Filename must end in .rbxl.");
  }

  if (contentLength === "0") {
    errors.push("A place file is required.");
  }

  errors.push(...packageOptions.errors);

  return {
    apiKey,
    universeId,
    placeId,
    versionType,
    originalFilename,
    fileExtension,
    packageSourcePlaceId: packageOptions.packageSourcePlaceId,
    packageKeys: packageOptions.packageKeys,
    errors
  };
}

function validateAssetPublishRequest(req, searchParams) {
  const apiKey = req.headers["x-api-key"];
  const universeId = (searchParams.get("universeId") || "").trim();
  const placeId = (searchParams.get("placeId") || "").trim();
  const versionType = (searchParams.get("versionType") || "published").trim().toLowerCase();
  const packageOptions = parsePackagePublishHeaders(req);
  const errors = [];

  if (!apiKey || Array.isArray(apiKey)) {
    errors.push("API key is required.");
  }

  if (!/^\d+$/.test(universeId)) {
    errors.push("Universe ID must be a number.");
  }

  if (!/^\d+$/.test(placeId)) {
    errors.push("Place ID must be a number.");
  }

  if (!["published", "saved"].includes(versionType)) {
    errors.push("Version type must be published or saved.");
  }

  errors.push(...packageOptions.errors);

  return {
    apiKey,
    universeId,
    placeId,
    versionType,
    packageSourcePlaceId: packageOptions.packageSourcePlaceId,
    packageKeys: packageOptions.packageKeys,
    errors
  };
}

function parsePackagePublishHeaders(req) {
  const errors = [];
  const rawSourcePlaceId = req.headers["x-package-source-place-id"];
  const rawPackageKeys = req.headers["x-package-keys"];
  const packageSourcePlaceId = Array.isArray(rawSourcePlaceId) ? "" : String(rawSourcePlaceId || "").trim();
  let packageKeys = [];

  if (Array.isArray(rawPackageKeys)) {
    errors.push("Package selection header must be a single JSON array.");
  } else if (rawPackageKeys) {
    try {
      const parsed = JSON.parse(String(rawPackageKeys));

      if (!Array.isArray(parsed)) {
        errors.push("Package selection header must be a JSON array.");
      } else {
        packageKeys = Array.from(new Set(parsed.map((key) => String(key || "").trim()).filter(Boolean)));
      }
    } catch {
      errors.push("Package selection header must be valid JSON.");
    }
  }

  if (packageKeys.length > 0 && !/^\d+$/.test(packageSourcePlaceId)) {
    errors.push("Package source Place ID is required when package replacements are selected.");
  }

  return {
    packageSourcePlaceId,
    packageKeys,
    errors
  };
}

function normalizePlace(place) {
  const pathMatch = typeof place.path === "string" ? place.path.match(/\/?places\/(\d+)/) : null;
  const id = place.id ?? place.placeId ?? (pathMatch ? pathMatch[1] : undefined);

  return {
    id: id ? String(id) : "",
    name: place.name || place.displayName || (id ? `Place ${id}` : "Untitled place"),
    description: place.description || "",
    isRootPlace: Boolean(place.isRootPlace || place.root),
    universeId: place.universeId ? String(place.universeId) : "",
    raw: place
  };
}

async function fetchPlacesPage(endpoint, cursor, apiKey) {
  const url = new URL(endpoint);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sortOrder", "Asc");

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const headers = {
    "accept": "application/json"
  };

  if (apiKey && endpoint.includes("apis.roblox.com")) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(url, { headers });
  const text = await response.text();

  return {
    endpoint: url.toString(),
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: parseMaybeJson(text)
  };
}

async function fetchRootPlaceId(universeId) {
  try {
    const response = await fetch(`https://develop.roblox.com/v1/universes/${universeId}`, {
      headers: {
        "accept": "application/json"
      }
    });
    const text = await response.text();
    const body = parseMaybeJson(text);
    return response.ok && body?.rootPlaceId ? String(body.rootPlaceId) : "";
  } catch {
    return "";
  }
}

async function handlePlaces(req, res, requestUrl) {
  const universeId = (requestUrl.searchParams.get("universeId") || "").trim();
  const apiKey = req.headers["x-api-key"];

  if (!/^\d+$/.test(universeId)) {
    sendJson(res, 400, {
      ok: false,
      errors: ["Universe ID must be a number."]
    });
    return;
  }

  const candidates = [
    `https://apis.roblox.com/v1/universes/${universeId}/places`,
    `https://develop.roblox.com/v1/universes/${universeId}/places`
  ];
  const attempts = [];

  for (const endpoint of candidates) {
    const places = [];
    let cursor = "";
    let pages = 0;

    try {
      do {
        const page = await fetchPlacesPage(endpoint, cursor, Array.isArray(apiKey) ? "" : apiKey);
        attempts.push({
          endpoint: page.endpoint,
          status: page.status,
          statusText: page.statusText
        });

        if (!page.ok) {
          places.length = 0;
          break;
        }

        const pagePlaces = Array.isArray(page.body?.data) ? page.body.data : [];
        places.push(...pagePlaces.map(normalizePlace).filter((place) => place.id));
        cursor = page.body?.nextPageCursor || "";
        pages += 1;
      } while (cursor && pages < 20);

      if (places.length > 0 || attempts.at(-1)?.status === 200) {
        const rootPlaceId = await fetchRootPlaceId(universeId);
        const normalizedPlaces = places.map((place) => ({
          ...place,
          isRootPlace: place.isRootPlace || place.id === rootPlaceId
        }));

        sendJson(res, 200, {
          ok: true,
          universeId,
          source: endpoint,
          rootPlaceId,
          places: normalizedPlaces,
          count: normalizedPlaces.length,
          attempts
        });
        return;
      }
    } catch (error) {
      attempts.push({
        endpoint,
        status: 0,
        statusText: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  sendJson(res, 502, {
    ok: false,
    universeId,
    message: "Unable to fetch places for this universe.",
    attempts
  });
}

async function handlePackages(req, res, requestUrl) {
  const apiKey = req.headers["x-api-key"];
  const placeId = (requestUrl.searchParams.get("placeId") || "").trim();

  if (!apiKey || Array.isArray(apiKey)) {
    sendJson(res, 400, {
      ok: false,
      errors: ["API key is required."]
    });
    return;
  }

  if (!/^\d+$/.test(placeId)) {
    sendJson(res, 400, {
      ok: false,
      errors: ["Place ID must be a number."]
    });
    return;
  }

  try {
    const result = await indexPlacePackages({
      apiKey,
      placeId
    });

    sendJson(res, 200, {
      ...result,
      sourcePlaceId: placeId
    });
  } catch (error) {
    const payload = error?.payload || {};

    sendJson(res, payload.status || 502, {
      ok: false,
      status: payload.status || 502,
      statusText: payload.statusText || "Package indexing failed",
      placeId,
      assetDeliveryEndpoint: payload.assetDeliveryEndpoint,
      body: payload.body,
      message: error instanceof Error ? error.message : "Unable to index packages for this place."
    });
  }
}

async function publishToRoblox({ apiKey, universeId, placeId, versionType, originalFilename, fileExtension, body, source, packageSourcePlaceId, packageKeys }) {
  const command = resolveRbxcloudCommand();

  if (!command) {
    return {
      ok: false,
      status: 502,
      statusText: "rbxcloud unavailable",
      endpoint: "rbxcloud experience publish",
      publisher: "rbxcloud",
      versionType,
      originalFilename,
      body: null,
      message: "rbxcloud was not found. Install it on PATH, set RBXCLOUD_PATH, or use a portable build that bundles it."
    };
  }

  const buffer = Buffer.isBuffer(body) ? body : await streamToBuffer(body);

  if (buffer.length === 0) {
    return {
      ok: false,
      status: 400,
      statusText: "Empty file",
      endpoint: "rbxcloud experience publish",
      publisher: "rbxcloud",
      command: "rbxcloud experience publish",
      versionType,
      originalFilename,
      contentBytes: 0,
      message: "A non-empty .rbxl file is required."
    };
  }

  const { debugFile, latestDebugFile } = await saveDebugPlaceFile({
    placeId,
    buffer,
    fileExtension
  });

  let touched;

  try {
    touched = await touchPlaceFile({
      file: debugFile,
      apiKey,
      placeId,
      universeId,
      versionType,
      source,
      packageSourcePlaceId,
      packageKeys
    });
  } catch (error) {
    return {
      ok: false,
      status: 422,
      statusText: "Mutation failed",
      endpoint: "rbxcloud experience publish",
      publisher: "rbxcloud",
      command: "rbxcloud experience publish",
      versionType,
      originalFilename,
      debugFile,
      debugDirectory: DEBUG_PLACE_DIR,
      contentBytes: buffer.length,
      packageSourcePlaceId,
      packageUpdates: error?.payload?.packageUpdates,
      packages: error?.payload?.packages,
      message: error instanceof Error ? error.message : "Unable to mutate place file before publishing."
    };
  }

  await fsp.copyFile(debugFile, latestDebugFile);
  const mutatedStats = await fsp.stat(debugFile);

  const result = await runRbxcloudPublish({
    command,
    apiKey,
    universeId,
    placeId,
    versionType,
    filename: debugFile
  });

  return {
    ...result,
    endpoint: "rbxcloud experience publish",
    publisher: "rbxcloud",
    command: "rbxcloud experience publish",
    versionType,
    originalFilename,
    rbxcloudFilename: debugFile,
    debugFile,
    latestDebugFile,
    debugDirectory: DEBUG_PLACE_DIR,
    mutation: touched.mutation,
    packageSourcePlaceId: touched.packageSourcePlaceId,
    packageUpdates: touched.packageUpdates,
    packages: touched.packages,
    jaxonGuiPackage: touched.jaxonGuiPackage,
    originalContentBytes: buffer.length,
    contentBytes: mutatedStats.size
  };
}

async function verifyPublishedMarker({ apiKey, placeId, expectedValue }) {
  const attempts = [];
  const maxAttempts = Math.max(1, VERIFY_PUBLISH_ATTEMPTS);
  const delayMs = Math.max(0, VERIFY_PUBLISH_DELAY_MS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const verification = await verifyPlaceMarker({
        apiKey,
        placeId,
        expectedValue
      });
      const summary = {
        attempt,
        ok: Boolean(verification.ok),
        found: Boolean(verification.verification?.found),
        valueMatches: Boolean(verification.verification?.valueMatches),
        actualValue: verification.verification?.actualValue,
        jaxonGuiPackage: verification.jaxonGuiPackage,
        contentBytes: verification.verification?.contentBytes,
        assetDeliveryEndpoint: verification.download?.assetDeliveryEndpoint
      };

      attempts.push(summary);

      if (verification.ok) {
        return {
          ok: true,
          attempts,
          ...verification
        };
      }
    } catch (error) {
      const payload = error?.payload || {};

      attempts.push({
        attempt,
        ok: false,
        status: payload.status || 0,
        statusText: payload.statusText || "",
        assetDeliveryEndpoint: payload.assetDeliveryEndpoint,
        message: error instanceof Error ? error.message : "Unable to verify published marker."
      });
    }

    if (attempt < maxAttempts && delayMs > 0) {
      await wait(delayMs);
    }
  }

  return {
    ok: false,
    attempts,
    message: "rbxcloud accepted the publish, but a fresh Roblox download did not contain the expected LastPublishTouch value."
  };
}

async function applyPublishedVerification({ result, apiKey, placeId, versionType, expectedValue }) {
  if (!result.ok || versionType !== "published" || !expectedValue) {
    return result;
  }

  const verification = await verifyPublishedMarker({
    apiKey,
    placeId,
    expectedValue
  });

  if (verification.ok) {
    return {
      ...result,
      verification
    };
  }

  return {
    ...result,
    ok: false,
    publishAccepted: true,
    status: 409,
    statusText: "Publish verification failed",
    verification,
    message: verification.message
  };
}

async function publishRobloxAssetToRoblox({ apiKey, universeId, placeId, versionType, packageSourcePlaceId, packageKeys }) {
  const command = resolveRbxcloudCommand();
  const originalFilename = `place-${placeId}.rbxl`;

  if (!command) {
    return {
      ok: false,
      status: 502,
      statusText: "rbxcloud unavailable",
      endpoint: "rbxcloud experience publish",
      publisher: "rbxcloud",
      versionType,
      originalFilename,
      body: null,
      message: "rbxcloud was not found. Install it on PATH, set RBXCLOUD_PATH, or use a portable build that bundles it."
    };
  }

  await fsp.mkdir(DEBUG_PLACE_DIR, { recursive: true });

  const { debugFile, latestDebugFile } = getDebugPlacePaths({
    placeId,
    fileExtension: ".rbxl"
  });

  let touched;

  try {
    touched = await touchPlaceFile({
      file: debugFile,
      apiKey,
      downloadPlaceId: placeId,
      placeId,
      universeId,
      versionType,
      source: "assetDelivery",
      packageSourcePlaceId,
      packageKeys
    });
  } catch (error) {
    const payload = error?.payload || {};

    return {
      ok: false,
      status: payload.status || 422,
      statusText: payload.statusText || "Lune download/mutation failed",
      endpoint: "Lune Asset Delivery download and place mutation",
      publisher: "rbxcloud",
      command: "lune run scripts/touch-place-file.luau",
      versionType,
      originalFilename,
      source: "robloxAsset",
      debugFile,
      debugDirectory: DEBUG_PLACE_DIR,
      assetDeliveryEndpoint: payload.assetDeliveryEndpoint,
      packageSourcePlaceId,
      packageUpdates: payload.packageUpdates,
      packages: payload.packages,
      body: payload.body,
      message: error instanceof Error ? error.message : "Unable to download and mutate place file before publishing."
    };
  }

  await fsp.copyFile(debugFile, latestDebugFile);
  const mutatedStats = await fsp.stat(debugFile);

  const publishResult = await runRbxcloudPublish({
    command,
    apiKey,
    universeId,
    placeId,
    versionType,
    filename: debugFile
  });
  const result = await applyPublishedVerification({
    result: publishResult,
    apiKey,
    placeId,
    versionType,
    expectedValue: touched.mutation?.value
  });

  return {
    ...result,
    endpoint: "rbxcloud experience publish",
    publisher: "rbxcloud",
    command: "rbxcloud experience publish",
    versionType,
    originalFilename,
    rbxcloudFilename: debugFile,
    debugFile,
    latestDebugFile,
    debugDirectory: DEBUG_PLACE_DIR,
    source: "robloxAsset",
    assetDeliveryEndpoint: touched.download?.assetDeliveryEndpoint,
    downloadLocation: touched.download?.downloadLocation,
    mutation: touched.mutation,
    packageSourcePlaceId: touched.packageSourcePlaceId,
    packageSourceDownload: touched.packageSourceDownload,
    packageUpdates: touched.packageUpdates,
    packages: touched.packages,
    jaxonGuiPackage: touched.jaxonGuiPackage,
    originalContentBytes: touched.download?.contentBytes ?? touched.mutation?.originalBytes,
    sourceContentBytes: touched.download?.contentBytes,
    contentBytes: mutatedStats.size
  };
}

async function handlePublish(req, res, requestUrl) {
  const validation = validatePublishRequest(req, requestUrl.searchParams);

  if (validation.errors.length > 0) {
    req.resume();
    sendJson(res, 400, {
      ok: false,
      errors: validation.errors
    });
    return;
  }

  try {
    const result = await publishToRoblox({
      apiKey: validation.apiKey,
      universeId: validation.universeId,
      placeId: validation.placeId,
      versionType: validation.versionType,
      originalFilename: validation.originalFilename,
      fileExtension: validation.fileExtension,
      body: req,
      source: "localFile",
      packageSourcePlaceId: validation.packageSourcePlaceId,
      packageKeys: validation.packageKeys
    });

    sendJson(res, result.status, result);
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      message: error instanceof Error ? error.message : "Unable to reach Roblox Open Cloud."
    });
  }
}

async function handlePublishAsset(req, res, requestUrl) {
  const validation = validateAssetPublishRequest(req, requestUrl.searchParams);

  if (validation.errors.length > 0) {
    req.resume();
    sendJson(res, 400, {
      ok: false,
      errors: validation.errors
    });
    return;
  }

  req.resume();

  try {
    const result = await publishRobloxAssetToRoblox({
      apiKey: validation.apiKey,
      universeId: validation.universeId,
      placeId: validation.placeId,
      versionType: validation.versionType,
      packageSourcePlaceId: validation.packageSourcePlaceId,
      packageKeys: validation.packageKeys
    });

    sendJson(res, result.status, result);
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      source: "robloxAsset",
      message: error instanceof Error ? error.message : "Unable to publish Roblox asset copy."
    });
  }
}

async function handleClearDebugPlaces(req, res) {
  req.resume();

  try {
    const result = await clearDebugPlaceFiles();

    sendJson(res, 200, {
      ok: true,
      action: "clearDebug",
      debugDirectory: DEBUG_PLACE_DIR,
      ...result
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      action: "clearDebug",
      debugDirectory: DEBUG_PLACE_DIR,
      message: error instanceof Error ? error.message : "Unable to clear debug place files."
    });
  }
}

function serveStatic(req, res, requestUrl) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decodedPath = decodeURIComponent(pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== PUBLIC_DIR) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    const contentType = MIME_TYPES.get(extension) || "application/octet-stream";

    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/places") {
    handlePlaces(req, res, requestUrl);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/packages") {
    handlePackages(req, res, requestUrl);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/publish") {
    handlePublish(req, res, requestUrl);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/publish-asset") {
    handlePublishAsset(req, res, requestUrl);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/debug/clear") {
    handleClearDebugPlaces(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, requestUrl);
    return;
  }

  res.writeHead(405, { allow: "GET, HEAD, POST" });
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Roblox Place Publisher running at ${url}`);

  if (process.env.OPEN_BROWSER === "1") {
    openBrowser(url);
  }
});
