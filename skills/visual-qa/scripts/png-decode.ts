import { Buffer } from "node:buffer"
import { inflateSync } from "node:zlib"

import { PNG_SIGNATURE } from "./png-crc.ts"
import type { DecodedImage } from "./types.ts"

/** Raised for structurally invalid input and for PNG variants this decoder does not support. */
export class PngDecodeError extends Error {
	/** Stable class name, kept as a literal so a caller can identify the error without `instanceof`. */
	readonly name = "PngDecodeError"
}

/** The IHDR fields this decoder uses, with the sample count derived from the colour type. */
interface PngHeader {
	/** Image width in pixels. */
	readonly width: number
	/** Image height in pixels. */
	readonly height: number
	/** Bits per sample; only 8 is supported. */
	readonly bitDepth: number
	/** PNG colour type byte (0, 2, 4 or 6). */
	readonly colorType: number
	/** Samples per pixel, derived from {@link colorType}. */
	readonly channels: number
}

/** One PNG chunk as sliced out of the file: its four-character type and its payload. */
interface PngChunk {
	/** Chunk type, e.g. `IHDR` or `IDAT`. */
	readonly type: string
	/** Chunk payload, without the length prefix or the trailing CRC. */
	readonly data: Buffer
}

/** Walk the chunk stream that follows the eight-byte signature, stopping at the first truncated or over-long chunk. */
function readChunks(buffer: Buffer): readonly PngChunk[] {
	/** Chunks read so far, in file order. */
	const chunks: PngChunk[] = []
	/** Byte offset of the current chunk header, past the signature. */
	let offset = 8
	while (offset + 8 <= buffer.length) {
		/** Declared payload length of the current chunk. */
		const length = buffer.readUInt32BE(offset)
		/** Four-character chunk type. */
		const type = buffer.toString("ascii", offset + 4, offset + 8)
		/** Offset where the current chunk's payload starts. */
		const dataStart = offset + 8
		/** Offset one past the payload, where the CRC begins. */
		const dataEnd = dataStart + length
		if (dataEnd + 4 > buffer.length) break
		chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) })
		offset = dataEnd + 4
	}
	return chunks
}

/** Samples per pixel for a PNG colour type; every other type, palette included, raises {@link PngDecodeError} here. Bit depth is validated separately. */
function channelsForColorType(colorType: number): number {
	switch (colorType) {
		case 0:
			return 1
		case 2:
			return 3
		case 4:
			return 2
		case 6:
			return 4
		default:
			throw new PngDecodeError(`unsupported color type ${colorType}`)
	}
}

/** Read the IHDR payload; requires the 13 documented bytes. */
function parseHeader(data: Buffer): PngHeader {
	if (data.length < 13) {
		throw new PngDecodeError("invalid IHDR chunk length")
	}
	/** Colour type byte, read before the sample count is derived from it. */
	const colorType = data[9] ?? 0
	return {
		width: data.readUInt32BE(0),
		height: data.readUInt32BE(4),
		bitDepth: data[8] ?? 0,
		colorType,
		channels: channelsForColorType(colorType),
	}
}

/** The Paeth predictor: returns whichever of a (left), b (above) or c (upper-left) is closest to p = a + b - c. */
function paeth(a: number, b: number, c: number): number {
	/** The predictor's estimate, a + b - c. */
	const p = a + b - c
	/** Distance from the estimate to the left neighbour. */
	const pa = Math.abs(p - a)
	/** Distance from the estimate to the above neighbour. */
	const pb = Math.abs(p - b)
	/** Distance from the estimate to the upper-left neighbour. */
	const pc = Math.abs(p - c)
	if (pa <= pb && pa <= pc) return a
	if (pb <= pc) return b
	return c
}

/** Reverse one scanline filter; `prev` is the previously decoded row (null for the first row) and `bpp` the bytes per complete pixel. */
function unfilterRow(filterType: number, row: Buffer, prev: Buffer | null, bpp: number): Buffer {
	/** The reconstructed scanline. */
	const out = Buffer.alloc(row.length)
	for (let i = 0; i < row.length; i++) {
		/** The filtered byte read from the stream. */
		const raw = row[i] ?? 0
		/** Left neighbour in the reconstructed row, 0 at the row start. */
		const a = i >= bpp ? (out[i - bpp] ?? 0) : 0
		/** Above neighbour, 0 for the first row. */
		const b = prev ? (prev[i] ?? 0) : 0
		/** Upper-left neighbour, 0 at the row start and for the first row. */
		const c = i >= bpp && prev ? (prev[i - bpp] ?? 0) : 0
		switch (filterType) {
			case 0:
				out[i] = raw
				break
			case 1:
				out[i] = (raw + a) & 0xff
				break
			case 2:
				out[i] = (raw + b) & 0xff
				break
			case 3:
				out[i] = (raw + ((a + b) >> 1)) & 0xff
				break
			case 4:
				out[i] = (raw + paeth(a, b, c)) & 0xff
				break
			default:
				throw new PngDecodeError(`unsupported filter type ${filterType}`)
		}
	}
	return out
}

/** Inflate the IDAT stream and reverse every scanline filter, returning tightly packed samples of `bpp` bytes per pixel. */
function decodePixels(idat: Buffer, width: number, height: number, bpp: number): Buffer {
	/** The inflated, still row-filtered image data. */
	const inflated = inflateSync(idat)
	/** Bytes per unfiltered scanline. */
	const rowBytes = width * bpp
	if (inflated.length < height * (rowBytes + 1)) {
		throw new PngDecodeError("truncated image data")
	}
	/** The decoded samples, row-major. */
	const pixels = Buffer.alloc(width * height * bpp)
	/** Previously decoded row, null before the first one. */
	let prev: Buffer | null = null
	for (let y = 0; y < height; y++) {
		/** Offset of this row's filter byte in the inflated stream. */
		const rowStart = y * (rowBytes + 1)
		/** Filter type applied to this row. */
		const filterType = inflated[rowStart] ?? 0
		/** The filtered scanline bytes. */
		const filtered = inflated.subarray(rowStart + 1, rowStart + 1 + rowBytes)
		/** The reconstructed scanline. */
		const row = unfilterRow(filterType, filtered, prev, bpp)
		row.copy(pixels, y * rowBytes)
		prev = row
	}
	return pixels
}

/** Expand greyscale, greyscale-alpha, RGB or RGBA samples to RGBA and report whether any pixel is not fully opaque. */
function normalizeToRgba(
	pixels: Buffer,
	pixelCount: number,
	channels: number,
): { readonly rgba: Uint8Array; readonly hasTransparent: boolean } {
	/** The RGBA output, four bytes per pixel. */
	const rgba = new Uint8Array(pixelCount * 4)
	/** Whether a pixel with alpha below 255 has been seen. */
	let hasTransparent = false
	for (let i = 0; i < pixelCount; i++) {
		/** Offset of the source pixel in the packed input. */
		const src = i * channels
		/** Red channel, 0 until the colour type decides its source. */
		let r = 0
		/** Green channel, 0 until the colour type decides its source. */
		let g = 0
		/** Blue channel, 0 until the colour type decides its source. */
		let b = 0
		/** Alpha channel, 255 unless the colour type carries transparency. */
		let a = 255
		switch (channels) {
			case 1: {
				/** The greyscale sample behind this pixel, replicated across R, G and B. */
				const v = pixels[src] ?? 0
				r = v
				g = v
				b = v
				break
			}
			case 2: {
				/** The greyscale sample behind this pixel, replicated across R, G and B. */
				const v = pixels[src] ?? 0
				r = v
				g = v
				b = v
				a = pixels[src + 1] ?? 255
				break
			}
			case 3: {
				r = pixels[src] ?? 0
				g = pixels[src + 1] ?? 0
				b = pixels[src + 2] ?? 0
				break
			}
			default: {
				r = pixels[src] ?? 0
				g = pixels[src + 1] ?? 0
				b = pixels[src + 2] ?? 0
				a = pixels[src + 3] ?? 255
			}
		}
		/** Byte offset of this pixel in the RGBA output. */
		const dst = i * 4
		rgba[dst] = r
		rgba[dst + 1] = g
		rgba[dst + 2] = b
		rgba[dst + 3] = a
		if (a < 255) hasTransparent = true
	}
	return { rgba, hasTransparent }
}

/** Decode a PNG buffer into RGBA pixels; raises {@link PngDecodeError} on a bad signature, a missing IHDR or IDAT, or an unsupported bit depth or colour type. */
export function decodePng(buffer: Buffer): DecodedImage {
	if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
		throw new PngDecodeError("not a PNG file (bad signature)")
	}
	/** Every chunk in the file, in file order. */
	const chunks = readChunks(buffer)
	/** The first IHDR chunk, the only one this decoder reads. */
	const ihdr = chunks.find((chunk) => chunk.type === "IHDR")
	if (ihdr === undefined) {
		throw new PngDecodeError("missing IHDR chunk")
	}
	/** The parsed header. */
	const header = parseHeader(ihdr.data)
	if (header.bitDepth !== 8) {
		throw new PngDecodeError(`unsupported bit depth ${header.bitDepth}`)
	}
	/** Every IDAT chunk, concatenated below into one deflate stream. */
	const idatChunks = chunks.filter((chunk) => chunk.type === "IDAT")
	if (idatChunks.length === 0) {
		throw new PngDecodeError("missing IDAT chunk")
	}
	/** The complete deflate stream. */
	const idat = Buffer.concat(idatChunks.map((chunk) => chunk.data))
	/** The decoded samples, still in the file's channel layout. */
	const pixels = decodePixels(idat, header.width, header.height, header.channels)
	/** The result of expanding those samples to RGBA. */
	const normalized = normalizeToRgba(pixels, header.width * header.height, header.channels)
	return {
		width: header.width,
		height: header.height,
		rgba: normalized.rgba,
		hasAlphaChannel: header.colorType === 4 || header.colorType === 6,
		hasTransparentPixels: normalized.hasTransparent,
	}
}
