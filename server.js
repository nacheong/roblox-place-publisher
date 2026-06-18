const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.resolve(__dirname, "public");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
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

function validatePublishRequest(req, searchParams) {
  const apiKey = req.headers["x-api-key"];
  const universeId = (searchParams.get("universeId") || "").trim();
  const placeId = (searchParams.get("placeId") || "").trim();
  const versionType = (searchParams.get("versionType") || "Published").trim();
  const contentType = (searchParams.get("contentType") || req.headers["content-type"] || "").trim();
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

  if (!["Published", "Saved"].includes(versionType)) {
    errors.push("Version type must be Published or Saved.");
  }

  if (!["application/octet-stream", "application/xml"].includes(contentType)) {
    errors.push("Content type must be application/octet-stream or application/xml.");
  }

  if (contentLength === "0") {
    errors.push("A place file is required.");
  }

  return {
    apiKey,
    universeId,
    placeId,
    versionType,
    contentType,
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

  const endpoint = `https://apis.roblox.com/universes/v1/${validation.universeId}/places/${validation.placeId}/versions?versionType=${encodeURIComponent(validation.versionType)}`;

  try {
    const upstreamResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": validation.apiKey,
        "content-type": validation.contentType
      },
      body: req,
      duplex: "half"
    });

    const text = await upstreamResponse.text();

    sendJson(res, upstreamResponse.status, {
      ok: upstreamResponse.ok,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      endpoint,
      contentType: validation.contentType,
      versionType: validation.versionType,
      body: parseMaybeJson(text)
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      endpoint,
      message: error instanceof Error ? error.message : "Unable to reach Roblox Open Cloud."
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

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, requestUrl);
    return;
  }

  res.writeHead(405, { allow: "GET, HEAD, POST" });
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Roblox Place Publisher running at http://${HOST}:${PORT}`);
});
