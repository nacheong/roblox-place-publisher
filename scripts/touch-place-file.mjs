import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { touchPlaceBuffer } from "../lib/place-touch.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    file: "",
    placeId: "",
    universeId: "",
    versionType: "published",
    source: "githubActions"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--file") {
      args.file = argv[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--file=")) {
      args.file = value.slice("--file=".length);
    } else if (value === "--place-id") {
      args.placeId = argv[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--place-id=")) {
      args.placeId = value.slice("--place-id=".length);
    } else if (value === "--universe-id") {
      args.universeId = argv[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--universe-id=")) {
      args.universeId = value.slice("--universe-id=".length);
    } else if (value === "--version-type") {
      args.versionType = argv[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--version-type=")) {
      args.versionType = value.slice("--version-type=".length);
    } else if (value === "--source") {
      args.source = argv[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--source=")) {
      args.source = value.slice("--source=".length);
    }
  }

  return args;
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  requireValue(args.file, "--file");
  requireValue(args.placeId, "--place-id");
  requireValue(args.universeId, "--universe-id");
  requireValue(args.versionType, "--version-type");

  const file = path.resolve(ROOT, args.file);
  const buffer = await fs.readFile(file);
  const touched = touchPlaceBuffer(buffer, {
    placeId: args.placeId,
    universeId: args.universeId,
    versionType: args.versionType,
    source: args.source
  });

  await fs.writeFile(file, touched.buffer);
  console.log(JSON.stringify({
    ok: true,
    file,
    mutation: touched.mutation
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
