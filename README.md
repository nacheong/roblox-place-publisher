# Roblox Place Publisher

A local web interface for quickly publishing Roblox `.rbxl` and `.rbxlx` place files through Roblox Open Cloud.

The app runs on your machine, shows the exact publish request it will make, can find places associated with a Universe ID, and lets you publish the same place file to one or more selected places.

## Requirements

- Node.js 18 or newer
- Roblox Open Cloud API key with `universe-places:write`
- Universe ID for the Roblox experience
- A `.rbxl` or `.rbxlx` place file

## Launch

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
6. Select a `.rbxl` or `.rbxlx` file.
7. Review the generated request preview.
8. Click **Publish**.

## Token Storage

Use **Remember token** to store the API key locally in this browser's `localStorage`.

This is convenient for a local workflow, but it is not encrypted. Avoid using it on shared machines.

Use **Reset** to clear remembered IDs, remembered token, selected file state, and response output.

## API Behavior

The local server forwards publish uploads to:

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
package.json        npm launch script
```

## Troubleshooting

- `401`: Check that your API key is valid.
- `403`: Confirm the key has `universe-places:write` for the selected experience.
- `404`: Verify the Universe ID and Place ID.
- `409`: The selected place is not part of the entered universe.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.

## Roblox Docs

- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/places
