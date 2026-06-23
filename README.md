# Roblox Place Publisher

A local web interface for quickly publishing Roblox places with `rbxcloud`.

The app can load places associated with a Universe ID, remembers selected places in the browser, and publishes selected places without making you choose a `.rbxl` file by default.

The default **Roblox asset** source reads the current place asset from Roblox, then passes those downloaded bytes to `rbxcloud experience publish`.

## Requirements

- Roblox Open Cloud API key with:
  - `universe-places:write`
  - `asset:read`
  - `legacy-asset:manage`
- Universe ID for the Roblox experience
- Optional `.rbxl` file if you use the **Local file** fallback

## Launch

### Portable Download

Download the portable build for your operating system from GitHub Releases, unzip it, and run the launcher:

- Windows: `Launch Roblox Place Publisher.cmd`
- macOS: `Launch Roblox Place Publisher.command`
- Linux: `launch-roblox-place-publisher.sh`

Portable builds include Node.js and `rbxcloud`, so other developers do not need to install npm or the rbxcloud CLI.

The launcher opens:

```text
http://127.0.0.1:4173
```

### From Source

Source launches require Node.js 18 or newer.
They also require `rbxcloud` on `PATH`, or `RBXCLOUD_PATH` pointing to the `rbxcloud` executable.

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
5. Leave **Publish source** on **Roblox asset** for no-file publishing.
6. Choose `Published` or `Saved`.
7. Review the generated rbxcloud workflow preview.
8. Click **Publish**.

For the default no-file flow, the local server:

1. Runs `rbxcloud assets get --asset-id <placeId>` to read asset metadata.
2. Downloads the current delivered place asset bytes from Roblox Asset Delivery.
3. Writes those bytes to a temporary `.rbxl` file.
4. Runs `rbxcloud experience publish`.

The publish command follows the rbxcloud docs:

```text
rbxcloud experience publish --filename <FILENAME> --place-id <PLACE_ID> --universe-id <UNIVERSE_ID> --version-type <VERSION_TYPE> --api-key <API_KEY>
```

The API key is supplied to rbxcloud through `RBXCLOUD_API_KEY`, which rbxcloud supports, so the app does not need to print the real key in the command output.

## Local File Fallback

If you choose **Local file**, the local server receives the uploaded `.rbxl`, writes it to a temporary `.rbxl` filename, then runs:

```text
rbxcloud experience publish --filename <temp-file> --place-id <placeId> --universe-id <universeId> --version-type <published|saved>
```

When multiple places are selected in **Local file** mode, the same `.rbxl` file is published to every selected Place ID.

## Token Storage

Use **Remember token** to store the API key locally in this browser's `localStorage`.

This is convenient for a local workflow, but it is not encrypted. Avoid using it on shared machines.

Use **Reset** to clear remembered IDs, remembered token, selected places, selected file state, and response output.

## Project Structure

```text
server.js           Local HTTP server, place lookup, and rbxcloud runner
public/index.html   App markup
public/styles.css   App styles
public/app.js       Client-side validation, storage, and publish flow
scripts/            Portable package builder
.github/workflows/  GitHub Actions portable release builds
package.json        npm launch script
```

## Portable Builds

Maintainers can create portable zips locally:

```bash
npm run package:portable
```

GitHub Actions also builds portable packages for Windows, Linux, and macOS on pushes to `main`. Version tags attach the zips to a GitHub Release.

## Troubleshooting

- `401`: Check that your API key is valid.
- `403`: Confirm the key has `universe-places:write`, `asset:read`, `legacy-asset:manage`, creator ownership, and universe permissions.
- `404`: Verify the Universe ID and Place ID.
- `429`: Roblox is rate limiting publish requests. Wait, then retry a smaller batch.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.
- Package updates not appearing live: the **Roblox asset** source republishes Roblox's currently delivered place asset. It cannot see unsaved Studio session edits.

## Roblox Docs

- https://sleitnick.github.io/rbxcloud/cli/cli-experience/
- https://sleitnick.github.io/rbxcloud/cli/cli-assets/
- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/assets
- https://create.roblox.com/docs/cloud/reference/features/places
