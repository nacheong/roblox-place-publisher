# Roblox Place Publisher

A local web interface for quickly publishing Roblox places through Roblox Open Cloud.

The app runs on your machine, can find places associated with a Universe ID, and can publish the current Roblox-saved version that Studio would open without making you manually choose a `.rbxl` file.

## Requirements

- Roblox Open Cloud API key with:
  - `universe-places:write`
  - `legacy-asset:manage`
- Universe ID for the Roblox experience
- Optional: a `.rbxl` or `.rbxlx` place file if you use **Local file** mode

## Launch

### Portable Download

Download the portable build for your operating system from GitHub Releases, unzip it, and run the launcher:

- Windows: `Launch Roblox Place Publisher.cmd`
- macOS: `Launch Roblox Place Publisher.command`
- Linux: `launch-roblox-place-publisher.sh`

The portable builds include Node.js, so developers do not need to install Node.js or npm.

The launcher opens:

```text
http://127.0.0.1:4173
```

### From Source

Source launches require Node.js 18 or newer.

```bash
npm start
```

Open:

```text
http://127.0.0.1:4173
```

To run on a different port in PowerShell:

```powershell
$env:PORT = "4174"
npm start
```

## Usage

1. Enter your Roblox Open Cloud API key.
2. Enter the experience's Universe ID.
3. Click the search icon beside **Universe ID** to load associated places.
4. Select one or more places with the checkboxes, or enter a manual Place ID.
5. Leave **Publish source** on **Current Roblox version** to publish what Studio would load right now.
6. Choose `Published` or `Saved`.
7. Review the generated request preview.
8. Click **Publish**.

Use **Local file** mode only when you want to upload a specific `.rbxl` or `.rbxlx` file from disk.

## Token Storage

Use **Remember token** to store the API key locally in this browser's `localStorage`.

This is convenient for a local workflow, but it is not encrypted. Avoid using it on shared machines.

Use **Reset** to clear remembered IDs, remembered token, selected file state, and response output.

## API Behavior

For **Current Roblox version**, the local server:

1. Downloads the selected place's current asset through Roblox Asset Delivery.
2. Uploads those bytes to the Place Publishing API.

For **Local file**, the local server forwards the selected file to:

```text
https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
```

Content types:

- `.rbxl` uses `application/octet-stream`
- `.rbxlx` uses `application/xml`

Place discovery uses Roblox's universe places endpoint and paginates results so checkbox selection can include every associated place returned by Roblox.

## Project Structure

```text
server.js           Local HTTP server and Roblox API proxy
public/index.html   App markup
public/styles.css   App styles
public/app.js       Client-side validation, place lookup, storage, and publish flow
scripts/            Portable package builder
.github/workflows/  GitHub Actions portable release builds
package.json        npm launch script
```

## Portable Builds

Maintainers can create portable zips locally:

```bash
npm run package:portable
```

GitHub Actions also builds portable packages for Windows, Linux, and macOS on pushes to `main`. Version tags like `v1.0.1` attach the zips to a GitHub Release.

## Troubleshooting

- `401`: Check that your API key is valid.
- `403`: Confirm the key has `universe-places:write` and `legacy-asset:manage`.
- `404`: Verify the Universe ID and Place ID.
- `409`: The selected place is not part of the entered universe.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.

## Roblox Docs

- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/places
