# Roblox Place Publisher

A local web interface for quickly publishing a `.rbxl` file with `rbxcloud experience publish`.

The app can load places associated with a Universe ID, remembers selected places in the browser, and loops the same rbxcloud publish command over each selected Place ID.

Important: when multiple places are selected, the same `.rbxl` file is published to every selected Place ID.

## Requirements

- Roblox Open Cloud API key with `universe-places:write`
- Universe ID for the Roblox experience
- One `.rbxl` place file from Roblox Studio

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
5. Choose `Published` or `Saved`.
6. Select a `.rbxl` file.
7. Review the generated rbxcloud command preview.
8. Click **Publish**.

The generated command follows the rbxcloud docs:

```text
rbxcloud experience publish --filename <FILENAME> --place-id <PLACE_ID> --universe-id <UNIVERSE_ID> --version-type <VERSION_TYPE> --api-key <API_KEY>
```

The local server receives the uploaded `.rbxl`, writes it to a temporary `.rbxl` filename, then runs:

```text
rbxcloud experience publish --filename <temp-file> --place-id <placeId> --universe-id <universeId> --version-type <published|saved>
```

The API key is supplied to rbxcloud through `RBXCLOUD_API_KEY`, which rbxcloud supports, so the app does not need to print the real key in the command output.

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
- `403`: Confirm the key has `universe-places:write`, creator ownership, and universe permissions.
- `404`: Verify the Universe ID and Place ID.
- `429`: Roblox is rate limiting publish requests. Wait, then retry a smaller batch.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.
- Package updates not appearing live: export or save a `.rbxl` that already contains the package updates, then publish that file. This app now publishes the exact file you select.

## Roblox Docs

- https://sleitnick.github.io/rbxcloud/cli/cli-experience/
- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/places
