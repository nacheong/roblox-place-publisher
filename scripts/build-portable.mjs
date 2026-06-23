import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const CACHE_DIR = path.join(ROOT, ".portable-cache");
const APP_NAME = "roblox-place-publisher";
const DEFAULT_TARGETS = ["win-x64", "linux-x64", "macos-x64", "macos-arm64"];
const RBXCLOUD_VERSION = process.env.RBXCLOUD_VERSION || "0.17.0";

const TARGETS = {
  "win-x64": {
    nodePackage: "win-x64",
    archiveExtension: ".zip",
    runtimePath: ["node.exe"],
    rbxcloudPackage: `rbxcloud-${RBXCLOUD_VERSION}-win64.zip`,
    rbxcloudBinary: "rbxcloud.exe",
    launcherName: "Launch Roblox Place Publisher.cmd",
    launcher: windowsLauncher
  },
  "linux-x64": {
    nodePackage: "linux-x64",
    archiveExtension: ".tar.xz",
    runtimePath: ["bin", "node"],
    rbxcloudPackage: `rbxcloud-${RBXCLOUD_VERSION}-linux.zip`,
    rbxcloudBinary: "rbxcloud",
    launcherName: "launch-roblox-place-publisher.sh",
    launcher: unixLauncher
  },
  "macos-x64": {
    nodePackage: "darwin-x64",
    archiveExtension: ".tar.gz",
    runtimePath: ["bin", "node"],
    rbxcloudPackage: `rbxcloud-${RBXCLOUD_VERSION}-macos.zip`,
    rbxcloudBinary: "rbxcloud",
    launcherName: "Launch Roblox Place Publisher.command",
    launcher: unixLauncher
  },
  "macos-arm64": {
    nodePackage: "darwin-arm64",
    archiveExtension: ".tar.gz",
    runtimePath: ["bin", "node"],
    rbxcloudPackage: `rbxcloud-${RBXCLOUD_VERSION}-macos-aarch64.zip`,
    rbxcloudBinary: "rbxcloud",
    launcherName: "Launch Roblox Place Publisher.command",
    launcher: unixLauncher
  }
};

function parseArgs(argv) {
  const args = {
    targets: [],
    nodeVersion: process.env.PORTABLE_NODE_VERSION || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--target") {
      args.targets.push(argv[index + 1]);
      index += 1;
    } else if (value.startsWith("--target=")) {
      args.targets.push(value.slice("--target=".length));
    } else if (value === "--node-version") {
      args.nodeVersion = argv[index + 1];
      index += 1;
    } else if (value.startsWith("--node-version=")) {
      args.nodeVersion = value.slice("--node-version=".length);
    }
  }

  if (args.targets.length === 0) {
    args.targets = DEFAULT_TARGETS;
  }

  for (const target of args.targets) {
    if (!TARGETS[target]) {
      throw new Error(`Unknown target "${target}". Expected one of: ${Object.keys(TARGETS).join(", ")}`);
    }
  }

  return args;
}

async function resolveNodeVersion(requestedVersion) {
  if (requestedVersion) {
    return requestedVersion.replace(/^v/, "");
  }

  const response = await fetch("https://nodejs.org/dist/index.json");

  if (!response.ok) {
    throw new Error(`Unable to resolve Node version: ${response.status} ${response.statusText}`);
  }

  const releases = await response.json();
  const latestLts = releases.find((release) => release.lts);

  if (!latestLts?.version) {
    throw new Error("Unable to find a current Node LTS release.");
  }

  return latestLts.version.replace(/^v/, "");
}

function windowsLauncher() {
  return `@echo off
setlocal
cd /d "%~dp0app"
if "%HOST%"=="" set "HOST=127.0.0.1"
if "%PORT%"=="" set "PORT=4173"
set "OPEN_BROWSER=1"
"%~dp0runtime\\node.exe" server.js
pause
`;
}

function unixLauncher() {
  return `#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/app"

export HOST="\${HOST:-127.0.0.1}"
export PORT="\${PORT:-4173}"
export OPEN_BROWSER="\${OPEN_BROWSER:-1}"

"$DIR/runtime/bin/node" server.js
`;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeInside(parent, target) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);

  if (!resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to remove path outside ${resolvedParent}: ${resolvedTarget}`);
  }

  await fs.rm(resolvedTarget, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function downloadFile(url, destination) {
  if (await pathExists(destination)) {
    return;
  }

  console.log(`Downloading ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const file = await fs.open(destination, "w");

  try {
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      await file.write(value);
    }
  } finally {
    await file.close();
  }
}

async function extractArchive(archivePath, destination) {
  await removeInside(CACHE_DIR, destination);
  await fs.mkdir(destination, { recursive: true });

  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      await run("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`
      ]);
    } else {
      await run("unzip", ["-q", archivePath, "-d", destination]);
    }
  } else {
    await run("tar", ["-xf", archivePath, "-C", destination]);
  }
}

async function findExtractedNodeRoot(extractDir, nodeVersion, nodePackage) {
  const expected = path.join(extractDir, `node-v${nodeVersion}-${nodePackage}`);

  if (await pathExists(expected)) {
    return expected;
  }

  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("node-v"));

  if (!match) {
    throw new Error(`Unable to find extracted Node runtime in ${extractDir}`);
  }

  return path.join(extractDir, match.name);
}

async function copyAppFiles(appDir) {
  await fs.mkdir(appDir, { recursive: true });
  await fs.copyFile(path.join(ROOT, "server.js"), path.join(appDir, "server.js"));
  await fs.copyFile(path.join(ROOT, "package.json"), path.join(appDir, "package.json"));
  await fs.copyFile(path.join(ROOT, "README.md"), path.join(appDir, "README.md"));
  await fs.cp(path.join(ROOT, "public"), path.join(appDir, "public"), { recursive: true });
}

async function copyRuntime(nodeRoot, packageDir, targetConfig) {
  const runtimeDir = path.join(packageDir, "runtime");
  const sourceRuntime = path.join(nodeRoot, ...targetConfig.runtimePath);
  const targetRuntime = path.join(runtimeDir, ...targetConfig.runtimePath);

  await fs.mkdir(path.dirname(targetRuntime), { recursive: true });
  await fs.copyFile(sourceRuntime, targetRuntime);

  if (process.platform !== "win32") {
    await fs.chmod(targetRuntime, 0o755);
  }

  const licensePath = path.join(nodeRoot, "LICENSE");

  if (await pathExists(licensePath)) {
    await fs.copyFile(licensePath, path.join(runtimeDir, "NODE-LICENSE"));
  }
}

async function findExtractedRbxcloud(extractDir, binaryName) {
  const entries = await fs.readdir(extractDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(extractDir, entry.name);

    if (entry.isFile() && entry.name === binaryName) {
      return entryPath;
    }

    if (entry.isDirectory()) {
      const nested = await findExtractedRbxcloud(entryPath, binaryName);

      if (nested) {
        return nested;
      }
    }
  }

  return "";
}

async function copyRbxcloud(packageDir, targetConfig) {
  const archiveName = targetConfig.rbxcloudPackage;
  const archiveUrl = `https://github.com/Sleitnick/rbxcloud/releases/download/v${RBXCLOUD_VERSION}/${archiveName}`;
  const archivePath = path.join(CACHE_DIR, archiveName);
  const extractDir = path.join(CACHE_DIR, `${archiveName}-extract`);
  const toolsDir = path.join(packageDir, "tools");
  const targetBinary = path.join(toolsDir, targetConfig.rbxcloudBinary);

  await downloadFile(archiveUrl, archivePath);
  await extractArchive(archivePath, extractDir);

  const sourceBinary = await findExtractedRbxcloud(extractDir, targetConfig.rbxcloudBinary);

  if (!sourceBinary) {
    throw new Error(`Unable to find ${targetConfig.rbxcloudBinary} in ${archiveName}`);
  }

  await fs.mkdir(toolsDir, { recursive: true });
  await fs.copyFile(sourceBinary, targetBinary);

  if (!targetConfig.rbxcloudBinary.endsWith(".exe")) {
    await fs.chmod(targetBinary, 0o755);
  }
}

async function writePortableReadme(packageDir, target, nodeVersion) {
  const text = `Roblox Place Publisher portable build

Target: ${target}
Bundled Node.js: ${nodeVersion}
Bundled rbxcloud: ${RBXCLOUD_VERSION}

Run the launcher in this folder. It starts a local server and opens:

http://127.0.0.1:4173

Close the terminal window to stop the app.

No Node.js or npm install is required on this machine.
No separate rbxcloud install is required for this portable build.
`;

  await fs.writeFile(path.join(packageDir, "README-PORTABLE.txt"), text);
}

async function writeLauncher(packageDir, targetConfig) {
  const launcherPath = path.join(packageDir, targetConfig.launcherName);

  await fs.writeFile(launcherPath, targetConfig.launcher());

  if (process.platform !== "win32" || !launcherPath.endsWith(".cmd")) {
    await fs.chmod(launcherPath, 0o755);
  }
}

async function archivePackage(packageDir, outputZip) {
  await fs.rm(outputZip, { force: true });

  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -LiteralPath ${quotePowerShell(packageDir)} -DestinationPath ${quotePowerShell(outputZip)} -Force`
    ]);
  } else {
    await run("zip", ["-qr", outputZip, path.basename(packageDir)], {
      cwd: path.dirname(packageDir)
    });
  }
}

async function buildTarget(target, nodeVersion) {
  const targetConfig = TARGETS[target];
  const archiveName = `node-v${nodeVersion}-${targetConfig.nodePackage}${targetConfig.archiveExtension}`;
  const archiveUrl = `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`;
  const archivePath = path.join(CACHE_DIR, archiveName);
  const extractDir = path.join(CACHE_DIR, `${target}-node-v${nodeVersion}`);
  const packageName = `${APP_NAME}-${target}`;
  const workRoot = path.join(DIST_DIR, "portable-work");
  const packageDir = path.join(workRoot, packageName);
  const outputZip = path.join(DIST_DIR, `${packageName}.zip`);

  await fs.mkdir(DIST_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await downloadFile(archiveUrl, archivePath);
  await extractArchive(archivePath, extractDir);
  await removeInside(workRoot, packageDir).catch(async () => {
    await fs.mkdir(workRoot, { recursive: true });
  });
  await fs.mkdir(packageDir, { recursive: true });

  const nodeRoot = await findExtractedNodeRoot(extractDir, nodeVersion, targetConfig.nodePackage);

  await copyAppFiles(path.join(packageDir, "app"));
  await copyRuntime(nodeRoot, packageDir, targetConfig);
  await copyRbxcloud(packageDir, targetConfig);
  await writeLauncher(packageDir, targetConfig);
  await writePortableReadme(packageDir, target, nodeVersion);
  await archivePackage(packageDir, outputZip);

  console.log(`Created ${path.relative(ROOT, outputZip)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nodeVersion = await resolveNodeVersion(args.nodeVersion);

  console.log(`Using Node.js ${nodeVersion}`);

  for (const target of args.targets) {
    await buildTarget(target, nodeVersion);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
