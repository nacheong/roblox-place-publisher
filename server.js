const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");
const { touchPlaceFile } = require("./lib/place-touch.cjs");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.resolve(__dirname, "public");
const DEBUG_PLACE_DIR = path.resolve(__dirname, "debug-place-files");
const RBXCLOUD_BINARY = process.platform === "win32" ? "rbxcloud.exe" : "rbxcloud";

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

  const extension = fileExtension || ".rbxl";
  const timestamp = timestampForFilename();
  const debugFile = path.join(DEBUG_PLACE_DIR, `place-${placeId}-${timestamp}${extension}`);
  const latestFile = path.join(DEBUG_PLACE_DIR, `latest-place-${placeId}${extension}`);

  await fsp.writeFile(debugFile, buffer);

  return {
    debugFile,
    latestDebugFile: latestFile
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

  return {
    apiKey,
    universeId,
    placeId,
    versionType,
    originalFilename,
    fileExtension,
    errors
  };
}

function validateAssetPublishRequest(req, searchParams) {
  const apiKey = req.headers["x-api-key"];
  const universeId = (searchParams.get("universeId") || "").trim();
  const placeId = (searchParams.get("placeId") || "").trim();
  const versionType = (searchParams.get("versionType") || "published").trim().toLowerCase();
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

  return {
    apiKey,
    universeId,
    placeId,
    versionType,
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

async function publishToRoblox({ apiKey, universeId, placeId, versionType, originalFilename, fileExtension, body, source }) {
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
      placeId,
      universeId,
      versionType,
      source
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
    originalContentBytes: buffer.length,
    contentBytes: mutatedStats.size
  };
}

async function downloadPlaceFileFromAssetDelivery(apiKey, placeId) {
  const assetDeliveryEndpoint = `https://apis.roblox.com/asset-delivery-api/v1/assetId/${placeId}`;
  const assetResponse = await fetch(assetDeliveryEndpoint, {
    headers: {
      "accept": "application/json",
      "x-api-key": apiKey
    }
  });
  const assetText = await assetResponse.text();
  const assetBody = parseMaybeJson(assetText);

  if (!assetResponse.ok || !assetBody?.location) {
    return {
      ok: false,
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      assetDeliveryEndpoint,
      body: assetBody,
      message: "Unable to get a downloadable place asset URL from Roblox Asset Delivery."
    };
  }

  const contentResponse = await fetch(assetBody.location, {
    headers: {
      "accept": "application/octet-stream"
    }
  });

  if (!contentResponse.ok) {
    const text = await contentResponse.text();
    return {
      ok: false,
      status: contentResponse.status,
      statusText: contentResponse.statusText,
      assetDeliveryEndpoint,
      body: parseMaybeJson(text),
      message: "Unable to download the place file from Roblox Asset Delivery."
    };
  }

  const arrayBuffer = await contentResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    assetDeliveryEndpoint,
    contentBytes: buffer.length,
    buffer
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
      source: "localFile"
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

  const command = resolveRbxcloudCommand();

  if (!command) {
    sendJson(res, 502, {
      ok: false,
      status: 502,
      statusText: "rbxcloud unavailable",
      endpoint: "rbxcloud experience publish",
      publisher: "rbxcloud",
      message: "rbxcloud was not found. Install it on PATH, set RBXCLOUD_PATH, or use a portable build that bundles it."
    });
    return;
  }

  try {
    const placeFile = await downloadPlaceFileFromAssetDelivery(validation.apiKey, validation.placeId);

    if (!placeFile.ok) {
      sendJson(res, placeFile.status || 502, {
        ok: false,
        status: placeFile.status || 502,
        statusText: placeFile.statusText || "Asset delivery failed",
        source: "robloxAsset",
        assetDeliveryEndpoint: placeFile.assetDeliveryEndpoint,
        body: placeFile.body,
        message: placeFile.message || "Unable to download the place asset from Roblox."
      });
      return;
    }

    const result = await publishToRoblox({
      apiKey: validation.apiKey,
      universeId: validation.universeId,
      placeId: validation.placeId,
      versionType: validation.versionType,
      originalFilename: `place-${validation.placeId}.rbxl`,
      fileExtension: ".rbxl",
      body: placeFile.buffer,
      source: "assetDelivery"
    });

    sendJson(res, result.status, {
      ...result,
      source: "robloxAsset",
      assetDeliveryEndpoint: placeFile.assetDeliveryEndpoint,
      sourceContentBytes: placeFile.contentBytes
    });
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

  if (req.method === "POST" && requestUrl.pathname === "/api/publish") {
    handlePublish(req, res, requestUrl);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/publish-asset") {
    handlePublishAsset(req, res, requestUrl);
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
