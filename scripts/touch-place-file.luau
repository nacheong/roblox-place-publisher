local fs = require("@lune/fs")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local TOUCH_CONTAINER_NAME = "__RobloxPlacePublisher"
local TOUCH_INSTANCE_NAME = "LastPublishTouch"
local TOUCH_CLASS_NAME = "StringValue"

local function parseArgs(args)
	local values = {
		file = "",
		placeId = "unknown",
		universeId = "unknown",
		versionType = "published",
		source = "local",
		touchValue = "",
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
		else
			index += 1
		end
	end

	if values.touchValue == "" then
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

local args = parseArgs(process.args)

if args.file == "" then
	error("--file is required.")
end

local originalContents = fs.readFile(args.file)
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
