# Roblox Place Publisher

A local web interface for quickly publishing Roblox places through Roblox Open Cloud.

The app runs on your machine, can find places associated with a Universe ID, and publishes `.rbxl` or `.rbxlx` place files to one or more selected places.

## Requirements

- Roblox Open Cloud API key with:
  - `universe-places:write`
- Optional for the advanced Asset Delivery copy mode:
  - `legacy-asset:manage`
- Universe ID for the Roblox experience
- A `.rbxl` or `.rbxlx` place file for the recommended **Local file** mode

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
5. Leave **Publish source** on **Local file** for package rollouts and normal releases.
6. Choose `Published` or `Saved`.
7. Select a `.rbxl` or `.rbxlx` file exported or saved from Studio.
8. Review the generated request preview.
9. Click **Publish**.

For package rollouts, update packages in Studio first, save or export the updated place file, then upload that file with **Published** selected.

## Token Storage

Use **Remember token** to store the API key locally in this browser's `localStorage`.

This is convenient for a local workflow, but it is not encrypted. Avoid using it on shared machines.

Use **Reset** to clear remembered IDs, remembered token, selected file state, and response output.

## API Behavior

For **Local file**, the local server forwards the selected file to:

```text
https://apis.roblox.com/universes/v1/{universeId}/places/{placeId}/versions?versionType=Published
```

For **Asset Delivery copy**, the local server:

1. Downloads the selected place asset through Roblox Asset Delivery.
2. Uploads those bytes to the Place Publishing API.

Asset Delivery copy is advanced and may not include saved-but-unpublished Studio/package changes. Use **Local file** when you need to publish the result of Studio's package **Update All** workflow.

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
- `403`: Confirm the key has `universe-places:write`. Asset Delivery copy mode also needs `legacy-asset:manage`.
- `404`: Verify the Universe ID and Place ID.
- `409`: The selected place is not part of the entered universe.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.

## Roblox Docs

- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/places
- https://create.roblox.com/docs/projects/assets/packages
