const BINARY_MAGIC = Buffer.from("<roblox!", "ascii");
const BINARY_SIGNATURE = Buffer.from([0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]);
const TOUCH_KEY = "RobloxPlacePublisherTouch";

function timestampValue(date = new Date()) {
  return date.toISOString();
}

function isBinaryPlace(buffer) {
  return buffer.length >= 32
    && buffer.subarray(0, 8).equals(BINARY_MAGIC)
    && buffer.subarray(8, 14).equals(BINARY_SIGNATURE);
}

function readRobloxString(buffer, state) {
  if (state.offset + 4 > buffer.length) {
    throw new Error("Metadata string length is out of bounds.");
  }

  const length = buffer.readUInt32LE(state.offset);
  state.offset += 4;

  if (state.offset + length > buffer.length) {
    throw new Error("Metadata string data is out of bounds.");
  }

  const value = buffer.toString("utf8", state.offset, state.offset + length);
  state.offset += length;
  return value;
}

function writeRobloxString(value) {
  const bytes = Buffer.from(String(value), "utf8");
  const output = Buffer.alloc(4 + bytes.length);
  output.writeUInt32LE(bytes.length, 0);
  bytes.copy(output, 4);
  return output;
}

function parseMetaEntries(data) {
  const state = { offset: 0 };

  if (data.length < 4) {
    throw new Error("Metadata chunk is too short.");
  }

  const count = data.readUInt32LE(state.offset);
  state.offset += 4;
  const entries = new Map();

  for (let index = 0; index < count; index += 1) {
    const key = readRobloxString(data, state);
    const value = readRobloxString(data, state);
    entries.set(key, value);
  }

  return entries;
}

function buildMetaChunk(entries) {
  const pairs = Array.from(entries.entries()).sort(([left], [right]) => left.localeCompare(right));
  const count = Buffer.alloc(4);
  count.writeUInt32LE(pairs.length, 0);

  const data = Buffer.concat([
    count,
    ...pairs.flatMap(([key, value]) => [
      writeRobloxString(key),
      writeRobloxString(value)
    ])
  ]);
  const header = Buffer.alloc(16);

  header.write("META", 0, "ascii");
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(data.length, 8);
  header.writeUInt32LE(0, 12);

  return Buffer.concat([header, data]);
}

function findBinaryChunks(buffer) {
  const chunks = [];
  let offset = 32;

  while (offset + 16 <= buffer.length) {
    const rawName = buffer.toString("ascii", offset, offset + 4);
    const name = rawName.replace(/\0+$/g, "");
    const compressedLength = buffer.readUInt32LE(offset + 4);
    const uncompressedLength = buffer.readUInt32LE(offset + 8);
    const dataLength = compressedLength === 0 ? uncompressedLength : compressedLength;
    const dataStart = offset + 16;
    const dataEnd = dataStart + dataLength;

    if (dataEnd > buffer.length) {
      throw new Error(`Chunk ${name || rawName} extends past end of file.`);
    }

    chunks.push({
      name,
      compressedLength,
      uncompressedLength,
      offset,
      dataStart,
      dataEnd,
      end: dataEnd
    });

    offset = dataEnd;

    if (name === "END") {
      break;
    }
  }

  return chunks;
}

function touchBinaryPlace(buffer, touchValue) {
  const chunks = findBinaryChunks(buffer);
  const endChunk = chunks.find((chunk) => chunk.name === "END");

  if (!endChunk) {
    throw new Error("Unable to find END chunk in binary place file.");
  }

  const metaChunk = chunks.find((chunk) => chunk.name === "META");
  const entries = new Map();
  let mode = "inserted";

  if (metaChunk) {
    if (metaChunk.compressedLength !== 0) {
      throw new Error("Compressed META chunks are not supported for safe mutation.");
    }

    const existing = parseMetaEntries(buffer.subarray(metaChunk.dataStart, metaChunk.dataEnd));
    existing.forEach((value, key) => entries.set(key, value));
    mode = "updated";
  }

  entries.set(TOUCH_KEY, touchValue);
  const metaBuffer = buildMetaChunk(entries);
  const output = metaChunk
    ? Buffer.concat([
      buffer.subarray(0, metaChunk.offset),
      metaBuffer,
      buffer.subarray(metaChunk.end)
    ])
    : Buffer.concat([
      buffer.subarray(0, endChunk.offset),
      metaBuffer,
      buffer.subarray(endChunk.offset)
    ]);

  return {
    buffer: output,
    mutation: {
      ok: true,
      type: "binary-meta",
      mode,
      key: TOUCH_KEY,
      value: touchValue,
      originalBytes: buffer.length,
      mutatedBytes: output.length
    }
  };
}

function xmlSafeComment(value) {
  return String(value).replace(/--/g, "- -");
}

function touchXmlPlace(buffer, touchValue) {
  const text = buffer.toString("utf8");
  const closingIndex = text.lastIndexOf("</roblox>");

  if (closingIndex === -1) {
    throw new Error("Unable to find </roblox> closing tag in XML place file.");
  }

  const comment = `\n<!-- ${TOUCH_KEY}: ${xmlSafeComment(touchValue)} -->\n`;
  const outputText = `${text.slice(0, closingIndex)}${comment}${text.slice(closingIndex)}`;
  const output = Buffer.from(outputText, "utf8");

  return {
    buffer: output,
    mutation: {
      ok: true,
      type: "xml-comment",
      mode: "inserted",
      key: TOUCH_KEY,
      value: touchValue,
      originalBytes: buffer.length,
      mutatedBytes: output.length
    }
  };
}

function touchPlaceBuffer(buffer, options = {}) {
  const source = options.source || "local";
  const placeId = options.placeId || "unknown";
  const universeId = options.universeId || "unknown";
  const versionType = options.versionType || "published";
  const timestamp = options.timestamp || timestampValue();
  const touchValue = `timestamp=${timestamp};placeId=${placeId};universeId=${universeId};versionType=${versionType};source=${source}`;

  if (isBinaryPlace(buffer)) {
    return touchBinaryPlace(buffer, touchValue);
  }

  const prefix = buffer.subarray(0, Math.min(buffer.length, 256)).toString("utf8").trimStart();

  if (prefix.startsWith("<roblox")) {
    return touchXmlPlace(buffer, touchValue);
  }

  throw new Error("Unsupported place file format. Expected binary .rbxl or XML .rbxlx data.");
}

module.exports = {
  TOUCH_KEY,
  touchPlaceBuffer
};
