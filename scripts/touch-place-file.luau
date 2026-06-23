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

	if values.touchValue == "" and values.verifyPlaceId == "" then
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

local function downloadPlaceContents(apiKey, placeId)
	if apiKey == "" then
		fail("--api-key is required when --download-place-id is used.")
	end

	local endpoint = "https://apis.roblox.com/asset-delivery-api/v1/assetId/" .. placeId
	local assetResponse = net.request({
		url = endpoint,
		headers = {
			accept = "application/json",
			["x-api-key"] = apiKey,
		},
	})

	if not assetResponse.ok then
		fail("Unable to get a downloadable place asset URL from Roblox Asset Delivery.", assetResponse.statusCode, assetResponse.statusMessage, {
			assetDeliveryEndpoint = endpoint,
			body = decodeJson(assetResponse.body, "Asset Delivery error"),
		})
	end

	local assetBody = decodeJson(assetResponse.body, "Asset Delivery")
	local location = assetBody.location

	if type(location) ~= "string" or location == "" then
		fail("Roblox Asset Delivery did not return a downloadable location.", assetResponse.statusCode, assetResponse.statusMessage, {
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
		fail("Unable to download the place file from Roblox Asset Delivery.", contentResponse.statusCode, contentResponse.statusMessage, {
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

	local versionNumber = readPackageProperty(packageLink, "VersionNumber")
	local packageId = readPackageProperty(packageLink, "PackageId")
	local autoUpdate = readPackageProperty(packageLink, "AutoUpdate")
	local hasNewVersion = readPackageProperty(packageLink, "HasNewVersion")
	local status = readPackageProperty(packageLink, "Status")
	local modifiedState = readPackageProperty(packageLink, "ModifiedState")
	local packageAssetName = readPackageProperty(packageLink, "PackageAssetName")
	local defaultName = readPackageProperty(packageLink, "DefaultName")

	return {
		ok = true,
		targetPath = PACKAGE_TARGET_PATH,
		targetFound = true,
		packageLinkFound = true,
		packageLinkPath = packageLink:GetFullName(),
		versionNumber = versionNumber.value,
		versionNumberReadable = versionNumber.ok,
		versionNumberError = versionNumber.error,
		packageId = packageId.value,
		packageIdReadable = packageId.ok,
		packageIdError = packageId.error,
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
	}
end

local args = parseArgs(process.args)

if args.verifyPlaceId ~= "" then
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
		jaxonGuiPackage = inspectJaxonGuiPackage(game),
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
