const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const TOUCH_CONTAINER_NAME = "__RobloxPlacePublisher";
const TOUCH_INSTANCE_NAME = "LastPublishTouch";
const TOUCH_CLASS_NAME = "StringValue";

function timestampValue(date = new Date()) {
  return date.toISOString();
}

function toolBinaryName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function isPathLike(value) {
  return /[\\/]/.test(value) || path.isAbsolute(value);
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getLuneCandidates() {
  const luneBinary = toolBinaryName("lune");

  return uniqueValues([
    process.env.LUNE_BIN,
    path.resolve(__dirname, "..", "tools", luneBinary),
    path.resolve(__dirname, "..", "..", "tools", luneBinary),
    "lune"
  ]);
}

function getTouchScriptPath() {
  return path.resolve(__dirname, "..", "scripts", "touch-place-file.luau");
}

async function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        code: 0,
        stdout,
        stderr,
        error
      });
    });

    child.on("exit", (code) => {
      resolve({
        ok: code === 0,
        code: code || 0,
        stdout,
        stderr,
        error: null
      });
    });
  });
}

function parseLuneJson(stdout) {
  const text = String(stdout || "").trim();

  if (!text) {
    throw new Error("Lune did not return mutation details.");
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Lune returned non-JSON output: ${text}`);
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function parseEmbeddedJson(text) {
  const value = String(text || "");
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null;
  }

  try {
    return JSON.parse(value.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function buildTouchValue(options = {}) {
  const source = options.source || "local";
  const placeId = options.placeId || "unknown";
  const universeId = options.universeId || "unknown";
  const versionType = options.versionType || "published";
  const timestamp = options.timestamp || timestampValue();

  return `timestamp=${timestamp};placeId=${placeId};universeId=${universeId};versionType=${versionType};source=${source}`;
}

async function touchPlaceFile(options = {}) {
  const file = path.resolve(options.file || "");
  const script = getTouchScriptPath();
  const shouldDownload = Boolean(options.downloadPlaceId);

  if (!options.file) {
    throw new Error("A place file path is required for mutation.");
  }

  if (!shouldDownload && !fs.existsSync(file)) {
    throw new Error(`Place file does not exist: ${file}`);
  }

  if (!fs.existsSync(script)) {
    throw new Error(`Lune mutation script is missing: ${script}`);
  }

  const originalStats = shouldDownload ? null : await fsp.stat(file);
  const touchValue = buildTouchValue(options);
  const args = [
    "run",
    script,
    "--file",
    file,
    "--place-id",
    options.placeId || "unknown",
    "--universe-id",
    options.universeId || "unknown",
    "--version-type",
    options.versionType || "published",
    "--source",
    options.source || "local",
    "--touch-value",
    touchValue
  ];

  if (options.apiKey) {
    args.push("--api-key", options.apiKey);
  }

  if (options.downloadPlaceId) {
    args.push("--download-place-id", options.downloadPlaceId);
  }

  let lastError = null;

  for (const command of getLuneCandidates()) {
    if (isPathLike(command) && !fs.existsSync(command)) {
      continue;
    }

    const result = await runCommand(command, args);

    if (result.ok) {
      const payload = parseLuneJson(result.stdout);
      const mutatedStats = await fsp.stat(file);

      return {
        ...payload,
        file,
        command,
        mutation: {
          ...payload.mutation,
          originalBytes: originalStats?.size ?? payload.download?.contentBytes ?? payload.mutation?.originalBytes,
          mutatedBytes: mutatedStats.size
        }
      };
    }

    const details = [
      result.error?.message,
      result.stderr.trim(),
      result.stdout.trim()
    ].filter(Boolean).join("\n");

    const payload = parseEmbeddedJson(`${result.stderr}\n${result.stdout}`);
    lastError = new Error(payload?.message || details || `${command} exited with code ${result.code}`);
    lastError.payload = payload;

    if (!result.error || result.error.code !== "ENOENT") {
      break;
    }
  }

  throw lastError || new Error("Lune was not found. Install it on PATH, set LUNE_BIN, or use a portable build that bundles it.");
}

module.exports = {
  TOUCH_CLASS_NAME,
  TOUCH_CONTAINER_NAME,
  TOUCH_INSTANCE_NAME,
  touchPlaceFile
};
