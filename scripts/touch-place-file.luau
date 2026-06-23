local fs = require("@lune/fs")
local net = require("@lune/net")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local TOUCH_CONTAINER_NAME = "__RobloxPlacePublisher"
local TOUCH_INSTANCE_NAME = "LastPublishTouch"
local TOUCH_CLASS_NAME = "StringValue"
local PACKAGE_TARGET_SERVICE = "StarterGui"
local PACKAGE_TARGET_NAME = "JaxonGui"
local PACKAGE_TARGET_PATH = PACKAGE_TARGET_SERVICE .. "." .. PACKAGE_TARGET_NAME

local function parseArgs(args)
	local values = {
		file = "",
		placeId = "unknown",
		universeId = "unknown",
		versionType = "published",
		source = "local",
		touchValue = "",
		apiKey = "",
		downloadPlaceId = "",
		verifyPlaceId = "",
		indexPackagesPlaceId = "",
		packageSourcePlaceId = "",
		updatePackageKeys = "",
		expectedValue = "",
	}

	local index = 1

	while index <= #args do
		local arg = args[index]

		if arg == "--file" then
			values.file = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 7) == "--file=" then
			values.file = string.sub(arg, 8)
			index += 1
		elseif arg == "--place-id" then
			values.placeId = args[index + 1] or "unknown"
			index += 2
		elseif string.sub(arg, 1, 11) == "--place-id=" then
			values.placeId = string.sub(arg, 12)
			index += 1
		elseif arg == "--universe-id" then
			values.universeId = args[index + 1] or "unknown"
			index += 2
		elseif string.sub(arg, 1, 14) == "--universe-id=" then
			values.universeId = string.sub(arg, 15)
			index += 1
		elseif arg == "--version-type" then
			values.versionType = args[index + 1] or "published"
			index += 2
		elseif string.sub(arg, 1, 15) == "--version-type=" then
			values.versionType = string.sub(arg, 16)
			index += 1
		elseif arg == "--source" then
			values.source = args[index + 1] or "local"
			index += 2
		elseif string.sub(arg, 1, 9) == "--source=" then
			values.source = string.sub(arg, 10)
			index += 1
		elseif arg == "--touch-value" then
			values.touchValue = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 14) == "--touch-value=" then
			values.touchValue = string.sub(arg, 15)
			index += 1
		elseif arg == "--api-key" then
			values.apiKey = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 10) == "--api-key=" then
			values.apiKey = string.sub(arg, 11)
			index += 1
		elseif arg == "--download-place-id" then
			values.downloadPlaceId = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 20) == "--download-place-id=" then
			values.downloadPlaceId = string.sub(arg, 21)
			index += 1
		elseif arg == "--verify-place-id" then
			values.verifyPlaceId = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 18) == "--verify-place-id=" then
			values.verifyPlaceId = string.sub(arg, 19)
			index += 1
		elseif arg == "--index-packages-place-id" then
			values.indexPackagesPlaceId = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 26) == "--index-packages-place-id=" then
			values.indexPackagesPlaceId = string.sub(arg, 27)
			index += 1
		elseif arg == "--package-source-place-id" then
			values.packageSourcePlaceId = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 26) == "--package-source-place-id=" then
			values.packageSourcePlaceId = string.sub(arg, 27)
			index += 1
		elseif arg == "--update-package-keys" then
			values.updatePackageKeys = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 22) == "--update-package-keys=" then
			values.updatePackageKeys = string.sub(arg, 23)
			index += 1
		elseif arg == "--expected-value" then
			values.expectedValue = args[index + 1] or ""
			index += 2
		elseif string.sub(arg, 1, 17) == "--expected-value=" then
			values.expectedValue = string.sub(arg, 18)
			index += 1
		else
			index += 1
		end
	end

	if values.touchValue == "" and values.verifyPlaceId == "" and values.indexPackagesPlaceId == "" then
		values.touchValue = string.format(
			"timestamp=%s;placeId=%s;universeId=%s;versionType=%s;source=%s",
			DateTime.now():ToIsoDate(),
			values.placeId,
			values.universeId,
			values.versionType,
			values.source
		)
	end

	return values
end

local function fail(message, statusCode, statusMessage, extra)
	local payload = extra or {}

	payload.ok = false
	payload.message = message
	payload.status = statusCode
	payload.statusText = statusMessage

	error(serde.encode("json", payload))
end

local function decodeJson(body, label)
	local ok, decoded = pcall(serde.decode, "json", body)

	if not ok then
		fail(string.format("Unable to parse %s JSON.", label), nil, nil, {
			body = body,
		})
	end

	return decoded
end

local function downloadAssetContents(apiKey, assetId, assetKind)
	local kind = assetKind or "asset"

	if apiKey == "" then
		fail("--api-key is required when downloading " .. kind .. " contents.")
	end

	local endpoint = "https://apis.roblox.com/asset-delivery-api/v1/assetId/" .. assetId
	local assetResponse = net.request({
		url = endpoint,
		headers = {
			accept = "application/json",
			["x-api-key"] = apiKey,
		},
	})

	if not assetResponse.ok then
		fail("Unable to get a downloadable " .. kind .. " URL from Roblox Asset Delivery.", assetResponse.statusCode, assetResponse.statusMessage, {
			assetDeliveryEndpoint = endpoint,
			body = decodeJson(assetResponse.body, "Asset Delivery error"),
		})
	end

	local assetBody = decodeJson(assetResponse.body, "Asset Delivery")
	local location = assetBody.location

	if type(location) ~= "string" or location == "" then
		fail("Roblox Asset Delivery did not return a downloadable " .. kind .. " location.", assetResponse.statusCode, assetResponse.statusMessage, {
			assetDeliveryEndpoint = endpoint,
			body = assetBody,
		})
	end

	local contentResponse = net.request({
		url = location,
		headers = {
			accept = "application/octet-stream",
		},
	})

	if not contentResponse.ok then
		fail("Unable to download the " .. kind .. " file from Roblox Asset Delivery.", contentResponse.statusCode, contentResponse.statusMessage, {
			assetDeliveryEndpoint = endpoint,
			downloadLocation = location,
			body = contentResponse.body,
		})
	end

	return contentResponse.body, {
		ok = true,
		status = contentResponse.statusCode,
		statusText = contentResponse.statusMessage,
		assetDeliveryEndpoint = endpoint,
		downloadLocation = location,
		contentBytes = #contentResponse.body,
	}
end

local function downloadPlaceContents(apiKey, placeId)
	return downloadAssetContents(apiKey, placeId, "place")
end

local function getOrCreateTouchFolder(serverStorage)
	local folder = serverStorage:FindFirstChild(TOUCH_CONTAINER_NAME)
	local created = false

	if folder ~= nil and not folder:IsA("Folder") then
		error(string.format(
			"ServerStorage.%s already exists and is a %s, not a Folder.",
			TOUCH_CONTAINER_NAME,
			folder.ClassName
		))
	end

	if folder == nil then
		folder = roblox.Instance.new("Folder")
		folder.Name = TOUCH_CONTAINER_NAME
		folder.Parent = serverStorage
		created = true
	end

	return folder, created
end

local function getOrCreateTouchValue(folder)
	local marker = folder:FindFirstChild(TOUCH_INSTANCE_NAME)
	local created = false

	if marker ~= nil and not marker:IsA(TOUCH_CLASS_NAME) then
		error(string.format(
			"%s.%s already exists and is a %s, not a %s.",
			TOUCH_CONTAINER_NAME,
			TOUCH_INSTANCE_NAME,
			marker.ClassName,
			TOUCH_CLASS_NAME
		))
	end

	if marker == nil then
		marker = roblox.Instance.new(TOUCH_CLASS_NAME)
		marker.Name = TOUCH_INSTANCE_NAME
		marker.Parent = folder
		created = true
	end

	return marker, created
end

local function readTouchValue(game)
	local serverStorage = game:GetService("ServerStorage")
	local folder = serverStorage:FindFirstChild(TOUCH_CONTAINER_NAME)

	if folder == nil then
		return {
			found = false,
			containerFound = false,
			markerFound = false,
			actualValue = nil,
		}
	end

	local marker = folder:FindFirstChild(TOUCH_INSTANCE_NAME)

	if marker == nil then
		return {
			found = false,
			containerFound = true,
			markerFound = false,
			actualValue = nil,
		}
	end

	local isStringValue = marker:IsA(TOUCH_CLASS_NAME)
	local actualValue = isStringValue and marker.Value or nil

	return {
		found = isStringValue,
		containerFound = true,
		markerFound = true,
		actualValue = actualValue,
		className = marker.ClassName,
	}
end

local function safeReadProperty(instance, propertyName)
	local ok, value = pcall(function()
		return instance[propertyName]
	end)

	if ok then
		return {
			ok = true,
			value = value,
		}
	end

	return {
		ok = false,
		error = string.match(tostring(value), "^[^\n]+") or tostring(value),
	}
end

local function serializeProperty(value)
	local valueType = typeof(value)

	if value == nil then
		return nil
	end

	if valueType == "string" or valueType == "number" or valueType == "boolean" then
		return value
	end

	return tostring(value)
end

local function readPackageProperty(packageLink, propertyName)
	local read = safeReadProperty(packageLink, propertyName)

	return {
		ok = read.ok,
		value = serializeProperty(read.value),
		error = read.error,
	}
end

local function readPackageFields(packageLink)
	local versionNumber = readPackageProperty(packageLink, "VersionNumber")
	local packageId = readPackageProperty(packageLink, "PackageId")
	local packageContent = readPackageProperty(packageLink, "PackageContent")
	local autoUpdate = readPackageProperty(packageLink, "AutoUpdate")
	local hasNewVersion = readPackageProperty(packageLink, "HasNewVersion")
	local status = readPackageProperty(packageLink, "Status")
	local modifiedState = readPackageProperty(packageLink, "ModifiedState")
	local packageAssetName = readPackageProperty(packageLink, "PackageAssetName")
	local defaultName = readPackageProperty(packageLink, "DefaultName")
	local creator = readPackageProperty(packageLink, "Creator")

	return {
		versionNumber = versionNumber.value,
		versionNumberReadable = versionNumber.ok,
		versionNumberError = versionNumber.error,
		packageId = packageId.value,
		packageIdReadable = packageId.ok,
		packageIdError = packageId.error,
		packageContent = packageContent.value,
		packageContentReadable = packageContent.ok,
		packageContentError = packageContent.error,
		autoUpdate = autoUpdate.value,
		autoUpdateReadable = autoUpdate.ok,
		autoUpdateError = autoUpdate.error,
		hasNewVersion = hasNewVersion.value,
		hasNewVersionReadable = hasNewVersion.ok,
		hasNewVersionError = hasNewVersion.error,
		status = status.value,
		statusReadable = status.ok,
		statusError = status.error,
		modifiedState = modifiedState.value,
		modifiedStateReadable = modifiedState.ok,
		modifiedStateError = modifiedState.error,
		packageAssetName = packageAssetName.value,
		packageAssetNameReadable = packageAssetName.ok,
		packageAssetNameError = packageAssetName.error,
		defaultName = defaultName.value,
		defaultNameReadable = defaultName.ok,
		defaultNameError = defaultName.error,
		creator = creator.value,
		creatorReadable = creator.ok,
		creatorError = creator.error,
	}
end

local function copyFields(target, fields)
	for key, value in pairs(fields) do
		target[key] = value
	end
end

local function inspectJaxonGuiPackage(game)
	local starterGui = game:GetService(PACKAGE_TARGET_SERVICE)
	local target = starterGui:FindFirstChild(PACKAGE_TARGET_NAME)

	if target == nil then
		return {
			ok = false,
			targetPath = PACKAGE_TARGET_PATH,
			targetFound = false,
			packageLinkFound = false,
			message = PACKAGE_TARGET_PATH .. " was not found.",
		}
	end

	local packageLink = target:FindFirstChildOfClass("PackageLink")

	if packageLink == nil then
		return {
			ok = false,
			targetPath = PACKAGE_TARGET_PATH,
			targetFound = true,
			packageLinkFound = false,
			message = PACKAGE_TARGET_PATH .. " does not have a direct PackageLink child.",
		}
	end

	local result = {
		ok = true,
		targetPath = PACKAGE_TARGET_PATH,
		targetFound = true,
		packageLinkFound = true,
		packageLinkPath = packageLink:GetFullName(),
	}

	copyFields(result, readPackageFields(packageLink))

	return result
end

local function getPathSegments(instance)
	local segments = {}
	local current = instance

	while current ~= nil and current.ClassName ~= "DataModel" do
		table.insert(segments, 1, current.Name)
		current = current.Parent
	end

	return segments
end

local function joinPathSegments(segments)
	return table.concat(segments, ".")
end

local function makePackageKey(segments, occurrence)
	return serde.encode("json", {
		pathSegments = segments,
		occurrence = occurrence,
	})
end

local function publicPackageRecord(record)
	local output = {
		index = record.index,
		key = record.key,
		occurrence = record.occurrence,
		path = record.path,
		pathSegments = record.pathSegments,
		name = record.name,
		className = record.className,
		parentPath = record.parentPath,
		packageLinkPath = record.packageLinkPath,
		packageLinkName = record.packageLinkName,
	}

	copyFields(output, record.fields)

	return output
end

local function collectPackageRecords(game, includeInstances)
	local packages = {}
	local pathCounts = {}

	for _, descendant in game:GetDescendants() do
		if descendant:IsA("PackageLink") and descendant.Parent ~= nil then
			local packageRoot = descendant.Parent
			local segments = getPathSegments(packageRoot)
			local path = joinPathSegments(segments)

			pathCounts[path] = (pathCounts[path] or 0) + 1

			local parent = packageRoot.Parent
			local record = {
				index = #packages + 1,
				key = makePackageKey(segments, pathCounts[path]),
				occurrence = pathCounts[path],
				path = path,
				pathSegments = segments,
				name = packageRoot.Name,
				className = packageRoot.ClassName,
				parentPath = parent ~= nil and parent:GetFullName() or "",
				packageLinkPath = descendant:GetFullName(),
				packageLinkName = descendant.Name,
				fields = readPackageFields(descendant),
			}

			if includeInstances then
				record.root = packageRoot
				record.packageLink = descendant
			end

			table.insert(packages, record)
		end
	end

	return packages
end

local function listPackages(game)
	local records = collectPackageRecords(game, false)
	local output = {}

	for _, record in records do
		table.insert(output, publicPackageRecord(record))
	end

	return output
end

local function decodePackageKeys(encoded)
	if encoded == "" then
		return {}
	end

	local decoded = decodeJson(encoded, "selected package keys")

	if type(decoded) ~= "table" then
		fail("Selected package keys must be a JSON array.")
	end

	local keys = {}

	for _, value in decoded do
		if type(value) ~= "string" or value == "" then
			fail("Selected package keys must only contain non-empty strings.")
		end

		table.insert(keys, value)
	end

	return keys
end

local function parseAssetId(value)
	local text = tostring(value or "")
	local id = string.match(text, "rbxassetid://(%d+)")
		or string.match(text, "assetId=(%d+)")
		or string.match(text, "id=(%d+)")
		or string.match(text, "^(%d+)$")
		or string.match(text, "(%d+)$")

	return id
end

local function messageFromError(errorValue)
	local text = tostring(errorValue)
	local ok, decoded = pcall(serde.decode, "json", text)

	if ok and type(decoded) == "table" then
		return decoded.message or decoded.statusText or text, decoded
	end

	return string.match(text, "^[^\n]+") or text, nil
end

local function chooseReplacementRoot(instances, oldRoot)
	if type(instances) ~= "table" or #instances == 0 then
		return nil, "Source package clone did not contain any root instances."
	end

	if #instances == 1 then
		return instances[1], nil
	end

	for _, instance in instances do
		if instance.Name == oldRoot.Name and instance.ClassName == oldRoot.ClassName then
			return instance, nil
		end
	end

	for _, instance in instances do
		if instance.Name == oldRoot.Name then
			return instance, nil
		end
	end

	return nil, string.format("Source package clone produced %d root instances; expected one matching %s.", #instances, oldRoot.Name)
end

local function copySourcePackageRoot(sourceRecord, oldRoot)
	local serializeOk, modelContents = pcall(roblox.serializeModel, {
		sourceRecord.root,
	})

	if not serializeOk then
		return nil, "Unable to serialize the source package root: " .. tostring(modelContents)
	end

	local deserializeOk, instances = pcall(roblox.deserializeModel, modelContents)

	if not deserializeOk then
		return nil, "Unable to deserialize the cloned source package root: " .. tostring(instances)
	end

	return chooseReplacementRoot(instances, oldRoot)
end

local function packageIdsMatch(sourceRecord, targetRecord)
	local sourceAssetId = parseAssetId(sourceRecord.fields.packageId)
	local targetAssetId = parseAssetId(targetRecord.fields.packageId)

	if sourceAssetId ~= nil and targetAssetId ~= nil and sourceAssetId ~= targetAssetId then
		return false, sourceAssetId, targetAssetId
	end

	return true, sourceAssetId, targetAssetId
end

local function buildTargetRecordMap(records)
	local byKey = {}

	for _, record in records do
		byKey[record.key] = record
	end

	return byKey
end

local function replaceSelectedPackagesFromSource(targetGame, sourceGame, selectedKeys)
	local selected = {}
	local selectedCount = 0

	for _, key in selectedKeys do
		if not selected[key] then
			selected[key] = true
			selectedCount += 1
		end
	end

	if selectedCount == 0 then
		return {}
	end

	local sourceRecords = collectPackageRecords(sourceGame, true)
	local targetRecordsByKey = buildTargetRecordMap(collectPackageRecords(targetGame, true))
	local updates = {}
	local found = {}

	for _, sourceRecord in sourceRecords do
		if selected[sourceRecord.key] then
			found[sourceRecord.key] = true

			local update = {
				ok = false,
				key = sourceRecord.key,
				sourcePath = sourceRecord.path,
				targetPath = sourceRecord.path,
				name = sourceRecord.name,
				className = sourceRecord.className,
				packageId = sourceRecord.fields.packageId,
			}
			local targetRecord = targetRecordsByKey[sourceRecord.key]

			if targetRecord == nil then
				update.ok = true
				update.skipped = true
				update.reason = "missing-target-package"
				update.message = "Target place did not contain this package at the same path, so it was skipped."
				table.insert(updates, update)
				continue
			end

			local idsMatch, sourceAssetId, targetAssetId = packageIdsMatch(sourceRecord, targetRecord)

			update.sourceAssetId = sourceAssetId
			update.targetAssetId = targetAssetId
			update.targetPackageId = targetRecord.fields.packageId

			if not idsMatch then
				update.ok = true
				update.skipped = true
				update.reason = "different-package-id"
				update.message = "Target path exists, but its PackageId is different, so it was skipped."
				table.insert(updates, update)
				continue
			end

			local replacementRoot, chooseError = copySourcePackageRoot(sourceRecord, targetRecord.root)

			if replacementRoot == nil then
				update.message = chooseError
				table.insert(updates, update)
				continue
			end

			local parent = targetRecord.root.Parent

			if parent == nil then
				update.message = "Existing package root has no parent."
				table.insert(updates, update)
				continue
			end

			replacementRoot.Name = targetRecord.root.Name
			replacementRoot.Parent = parent
			targetRecord.root:Destroy()

			update.ok = true
			update.replaced = true
			update.message = "Package root replaced from the selected source place."
			update.replacementName = replacementRoot.Name
			update.replacementClassName = replacementRoot.ClassName

			table.insert(updates, update)
		end
	end

	for key in selected do
		if not found[key] then
			table.insert(updates, {
				ok = false,
				key = key,
				message = "Selected package was not found in the source place file.",
			})
		end
	end

	return updates
end

local function anyPackageUpdateFailed(packageUpdates)
	for _, update in packageUpdates do
		if not update.ok then
			return true
		end
	end

	return false
end

local args = parseArgs(process.args)

if args.indexPackagesPlaceId ~= "" then
	local contents, downloadInfo = downloadPlaceContents(args.apiKey, args.indexPackagesPlaceId)
	local game = roblox.deserializePlace(contents)
	local packages = listPackages(game)

	print(serde.encode("json", {
		ok = true,
		download = downloadInfo,
		placeId = args.indexPackagesPlaceId,
		jaxonGuiPackage = inspectJaxonGuiPackage(game),
		packageCount = #packages,
		packages = packages,
	}))
elseif args.verifyPlaceId ~= "" then
	local contents, downloadInfo = downloadPlaceContents(args.apiKey, args.verifyPlaceId)
	local game = roblox.deserializePlace(contents)
	local touch = readTouchValue(game)
	local expectedValue = args.expectedValue
	local valueMatches = expectedValue == "" and touch.found or touch.actualValue == expectedValue

	print(serde.encode("json", {
		ok = valueMatches,
		download = downloadInfo,
		jaxonGuiPackage = inspectJaxonGuiPackage(game),
		verification = {
			ok = valueMatches,
			type = "instance-stringvalue",
			containerService = "ServerStorage",
			containerName = TOUCH_CONTAINER_NAME,
			instanceName = TOUCH_INSTANCE_NAME,
			className = touch.className,
			propertyName = "Value",
			found = touch.found,
			containerFound = touch.containerFound,
			markerFound = touch.markerFound,
			valueMatches = valueMatches,
			expectedValue = expectedValue,
			actualValue = touch.actualValue,
			contentBytes = #contents,
		},
	}))
else
	if args.file == "" then
		error("--file is required.")
	end

	local originalContents
	local downloadInfo = nil

	if args.downloadPlaceId ~= "" then
		originalContents, downloadInfo = downloadPlaceContents(args.apiKey, args.downloadPlaceId)
	else
		originalContents = fs.readFile(args.file)
	end

	local game = roblox.deserializePlace(originalContents)
	local packageUpdateKeys = decodePackageKeys(args.updatePackageKeys)
	local packageSourceDownload = nil
	local packageUpdates = {}

	if #packageUpdateKeys > 0 then
		local sourceGame = game

		if args.packageSourcePlaceId ~= "" and args.packageSourcePlaceId ~= args.downloadPlaceId and args.packageSourcePlaceId ~= args.placeId then
			local sourceContents

			sourceContents, packageSourceDownload = downloadPlaceContents(args.apiKey, args.packageSourcePlaceId)
			sourceGame = roblox.deserializePlace(sourceContents)
		end

		packageUpdates = replaceSelectedPackagesFromSource(game, sourceGame, packageUpdateKeys)
	end

	if anyPackageUpdateFailed(packageUpdates) then
		fail("One or more selected packages could not be replaced.", nil, nil, {
			packageSourcePlaceId = args.packageSourcePlaceId,
			packageUpdates = packageUpdates,
			packages = listPackages(game),
		})
	end

	local serverStorage = game:GetService("ServerStorage")
	local folder, createdFolder = getOrCreateTouchFolder(serverStorage)
	local marker, createdMarker = getOrCreateTouchValue(folder)

	marker.Value = args.touchValue

	local mutatedContents = roblox.serializePlace(game)

	fs.writeFile(args.file, mutatedContents)

	print(serde.encode("json", {
		ok = true,
		file = args.file,
		download = downloadInfo,
		packageSourcePlaceId = args.packageSourcePlaceId,
		packageSourceDownload = packageSourceDownload,
		jaxonGuiPackage = inspectJaxonGuiPackage(game),
		packages = listPackages(game),
		packageUpdates = packageUpdates,
		mutation = {
			ok = true,
			type = "instance-stringvalue",
			mode = createdMarker and "inserted" or "updated",
			containerCreated = createdFolder,
			containerService = "ServerStorage",
			containerName = TOUCH_CONTAINER_NAME,
			instanceName = TOUCH_INSTANCE_NAME,
			className = TOUCH_CLASS_NAME,
			propertyName = "Value",
			value = args.touchValue,
			originalBytes = #originalContents,
			mutatedBytes = #mutatedContents,
		},
	}))
end
