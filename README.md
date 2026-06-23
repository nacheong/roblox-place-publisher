# Roblox Place Publisher

A local web interface for quickly publishing Roblox places with `rbxcloud`.

The app can load places associated with a Universe ID, remembers selected places in the browser, and publishes selected places without making you choose a `.rbxl` file by default.

The default **Roblox asset** source asks Lune to download the current place asset from Roblox, update a small `ServerStorage` marker instance, save the changed `.rbxl`, then passes that saved file to `rbxcloud experience publish`.

## Requirements

- Roblox Open Cloud API key with:
  - `universe-places:write`
  - `legacy-asset:manage`
- Universe ID for the Roblox experience
- Optional `.rbxl` file if you use the **Local file** fallback

## Launch

### Portable Download

Download the portable build for your operating system from GitHub Releases, unzip it, and run the launcher:

- Windows: `Launch Roblox Place Publisher.cmd`
- macOS: `Launch Roblox Place Publisher.command`
- Linux: `launch-roblox-place-publisher.sh`

Portable builds include Node.js, `rbxcloud`, and Lune, so other developers do not need to install npm or Roblox CLI tools.

The launcher opens:

```text
http://127.0.0.1:4173
```

### From Source

Source launches require Node.js 18 or newer.
They also require:

- `rbxcloud` on `PATH`, or `RBXCLOUD_PATH` pointing to the `rbxcloud` executable.
- `lune` on `PATH`, or `LUNE_BIN` pointing to the Lune executable.

This repo includes both `aftman.toml` and `foreman.toml` for the tutorial-style Roblox toolchain flow. Use one:

```bash
aftman install
rbxcloud --version
lune --version
```

or:

```bash
foreman install
rbxcloud --version
lune --version
```

The pinned tools are:

```text
Sleitnick/rbxcloud@0.17.0
lune-org/lune@0.10.4
```

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
5. Optional package replacement workflow:
   - Select exactly one source place, such as the place where you already updated `StarterGui.JaxonGui`.
   - Click **Index** in **Package Replacements**.
   - Check the package roots you want to clone from that source place.
   - Select the final target places to publish. Targets that do not already have that package at the same path are skipped.
6. Leave **Publish source** on **Roblox asset** for no-file publishing.
7. Choose `Published` or `Saved`.
8. Optional: enable **Debug places** if you want to keep the exact `.rbxl` files passed to rbxcloud.
9. Review the generated rbxcloud workflow preview.
10. Click **Publish**.

You can get IDs from the Roblox Studio command bar:

```lua
print(game.PlaceId)
print(game.GameId)
```

For the default no-file flow, the local server asks Lune to:

1. Download the current delivered place asset bytes from Roblox Asset Delivery.
2. If package replacements are selected, download the package source place, clone the selected package roots from that place, and replace matching package roots in the target place.
3. Update `ServerStorage.__RobloxPlacePublisher.LastPublishTouch.Value`.
4. Save the mutated bytes under `debug-place-files/`.
5. Return the debug `.rbxl` path so the server can run `rbxcloud experience publish`.
6. Re-download the published place and verify the `LastPublishTouch` value matches the debug file.

The instance touch makes the file bytes change on each publish by editing a tiny `StringValue` under `ServerStorage`.
If rbxcloud accepts the publish but the re-downloaded place does not contain the expected value, the app reports **Publish not verified** instead of a clean success.
Publish results also include a `StarterGui.JaxonGui` package probe with its `PackageLink.VersionNumber`, `PackageId`, `AutoUpdate`, and status when those fields are available. If `VersionNumber` is not readable from the downloaded place file, the raw response includes the read error.

If a batch has failures, use **Retry failed** in the Response panel to retry only the failed place IDs with the current API key and publish settings.

## Package Replacement Flow

Use **Package Replacements** when Studio package auto-update is not showing up in live servers.

The indexed source place should already contain the package copy you want everywhere else. For example, if you updated `StarterGui.JaxonGui` in Place3, select only Place3, click **Index**, choose `StarterGui.JaxonGui`, then select Place1, Place2, and any other targets before publishing.

During publish, Lune downloads the source place and each target place. For every selected package, it replaces the target package root only when the target already has the same package path and matching `PackageId`. Missing packages and different packages are skipped instead of failing the whole batch.

The replacement is a real instance-level remove and replace: the source package root is serialized as a model, deserialized into the target place, parented into the old target package's parent, and the old package root is destroyed. The debug `.rbxl` saved for each target is the exact file passed to rbxcloud.

The publish command follows the rbxcloud docs:

```text
rbxcloud experience publish --filename <FILENAME> --place-id <PLACE_ID> --universe-id <UNIVERSE_ID> --version-type <VERSION_TYPE> --api-key <API_KEY>
```

The API key is supplied to rbxcloud through `RBXCLOUD_API_KEY`, which rbxcloud supports, so the app does not need to print the real key in the command output.

## Local File Fallback

If you choose **Local file**, the local server receives the uploaded `.rbxl`, updates `ServerStorage.__RobloxPlacePublisher.LastPublishTouch.Value`, saves it under `debug-place-files/`, then runs:

```text
rbxcloud experience publish --filename <temp-file> --place-id <placeId> --universe-id <universeId> --version-type <published|saved>
```

When multiple places are selected in **Local file** mode, the same `.rbxl` file is published to every selected Place ID.

## Debug Place Files

Enable **Debug places** when you want every publish attempt to keep the exact `.rbxl` bytes passed to rbxcloud:

```text
debug-place-files/place-<placeId>-<timestamp>.rbxl
debug-place-files/latest-place-<placeId>.rbxl
```

Use `latest-place-<placeId>.rbxl` when you want to quickly open the most recent pulled copy in Studio and check whether package updates are actually present.

The toggle is off by default. When it is off, the app still creates a temporary `.rbxl` because rbxcloud requires a filename, but deletes that temporary file after the publish attempt.

The folder is ignored by Git so downloaded place files are not committed accidentally.

The saved file is already touched with the `ServerStorage.__RobloxPlacePublisher.LastPublishTouch` `StringValue`, which is the same file that rbxcloud receives.

Use **Clear debug** in the Response panel to delete old debug `.rbxl` files created by this app.

## Command Line

The direct command-line publish flow from the tutorial is:

```bash
rbxcloud experience publish \
  --filename myplace.rbxl \
  --place-id 12345 \
  --universe-id 98765 \
  --version-type published \
  --api-key "$ROBLOX_API_KEY"
```

Use `saved` for `--version-type` if you only want Studio's saved version updated; use `published` to update the live game.

In PowerShell, you can keep the key out of shell history:

```powershell
$env:RBXCLOUD_API_KEY = "RBX-..."
rbxcloud experience publish --filename .\myplace.rbxl --place-id 12345 --universe-id 98765 --version-type published
```

## GitHub Actions Deploy

This repo includes `.github/workflows/deploy-place.yml`, which follows the rbxcloud/Aftman deploy flow:

1. Checks out the repo.
2. Installs Aftman with `ok-nick/setup-aftman`.
3. Uses `aftman.toml` to install `Sleitnick/rbxcloud@0.17.0` and `lune-org/lune@0.10.4`.
4. Runs `scripts/touch-place-file.mjs` to update the `ServerStorage` touch `StringValue`.
5. Runs `rbxcloud experience publish`.

Configure these in **GitHub repository settings > Secrets and variables > Actions**:

Secrets:

- `ROBLOX_API_KEY`: Roblox Open Cloud API key.

Variables:

- `ROBLOX_UNIVERSE_ID`: Universe ID.
- `ROBLOX_PLACE_FILE`: path to a committed `.rbxl` file, such as `places/main.rbxl`.
- `ROBLOX_PLACE_ID`: one Place ID, or use `ROBLOX_PLACE_IDS` for several.
- `ROBLOX_PLACE_IDS`: optional comma, space, or newline separated Place IDs.
- `ROBLOX_VERSION_TYPE`: optional, `published` or `saved`; defaults to `published`.

The workflow runs on manual dispatch. It also runs on pushes to `main` that change `.rbxl` files, `aftman.toml`, or the deploy workflow, but only when the required repository variables are set.

GitHub Actions cannot publish unsaved Roblox Studio state. The `.rbxl` must be committed to the repo or generated by adding a build step before the publish step.

The workflow mutates the `.rbxl` in the checked-out GitHub runner only; it does not commit the touched file back to the repository.

## Token Storage

Use **Remember token** to store the API key locally in this browser's `localStorage`.

This is convenient for a local workflow, but it is not encrypted. Avoid using it on shared machines.

Use **Reset** to clear remembered IDs, remembered token, selected places, indexed package selections, debug preference, selected file state, and response output.

## Project Structure

```text
server.js           Local HTTP server, place lookup, and rbxcloud runner
lib/place-touch.cjs Shared Lune-backed place touch runner
aftman.toml         Aftman rbxcloud and Lune tool pins
foreman.toml        Foreman rbxcloud and Lune tool pins
.github/workflows/deploy-place.yml
                    GitHub Actions rbxcloud deploy workflow
scripts/touch-place-file.mjs
                    CLI used by GitHub Actions to touch a place before publish
scripts/touch-place-file.luau
                    Lune script that downloads/indexes/replaces/touches/saves place files
debug-place-files/ Saved debug copies of place files, ignored by Git
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
- `403`: Confirm the key has `universe-places:write`, `legacy-asset:manage`, creator ownership, and universe permissions.
- `404`: Verify the Universe ID and Place ID.
- `429`: Roblox is rate limiting publish requests. Wait, then retry a smaller batch.
- Empty place list: verify the Universe ID, then use manual Place ID as a fallback.
- Package source is stale: the package replacement flow clones the package from the indexed source place's delivered Roblox asset. Open the saved debug file or the source place in Studio to confirm the selected package is already the updated one before publishing.
- Package skipped: the target place did not already have that package at the same path, or the path contained a different `PackageId`.
- Package updates not appearing live: the **Roblox asset** source republishes Roblox's currently delivered place asset. It cannot see unsaved Studio session edits.

## Roblox Docs

- https://sleitnick.github.io/rbxcloud/cli/cli-experience/
- https://lune-org.github.io/docs/api-reference/roblox/
- https://create.roblox.com/docs/cloud/guides/usage-place-publishing
- https://create.roblox.com/docs/cloud/reference/features/places
