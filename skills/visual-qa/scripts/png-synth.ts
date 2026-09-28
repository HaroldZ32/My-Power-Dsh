import { Buffer } from "node:buffer"
import { deflateSync } from "node:zlib"

import { crc32, PNG_SIGNATURE } from "./png-crc.ts"

/** Bit depth written into every synthesized IHDR: 8 bits per sample. */
const BIT_DEPTH_8 = 8
/** PNG colour type 6: truecolour with an alpha channel. */
const COLOR_TYPE_RGBA = 6
/** Filter byte prepended to each scanline; this encoder writes unfiltered rows. */
const FILTER_NONE = 0
/** Channels per pixel in the RGBA buffers this module writes. */
const RGBA_CHANNELS = 4

/** Frame one PNG chunk: big-endian length, four-byte ASCII type, data, then the CRC over type and data. */
function pngChunk(type: string, data: Buffer): Buffer {
	/** The chunk type as ASCII bytes, needed both in the output and in the CRC input. */
	const typeBuffer = Buffer.from(type, "ascii")
	/** Four-byte big-endian length prefix. */
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)
	/** Four-byte big-endian CRC-32 over the type and the data. */
	const crcBuffer = Buffer.alloc(4)
	crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
	return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

/** Encode raw RGBA bytes as a complete 8-bit RGBA PNG: signature, IHDR, one deflated IDAT and IEND. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
	/** Bytes per unfiltered scanline, width * {@link RGBA_CHANNELS}. */
	const rowBytes = width * RGBA_CHANNELS
	/** Zlib input buffer: each row is prefixed by its filter byte. */
	const raw = Buffer.alloc(height * (rowBytes + 1))
	for (let y = 0; y < height; y++) {
		/** Byte offset of this row's filter byte. */
		const rowStart = y * (rowBytes + 1)
		raw[rowStart] = FILTER_NONE
		for (let x = 0; x < rowBytes; x++) {
			raw[rowStart + 1 + x] = rgba[y * rowBytes + x] ?? 0
		}
	}
	/** The 13-byte IHDR payload: width, height, bit depth and colour type. */
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = BIT_DEPTH_8
	header[9] = COLOR_TYPE_RGBA
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	])
}

/**
 * Fill a width x height RGBA buffer with one colour.
 *
 * @param width buffer width in pixels.
 * @param height buffer height in pixels.
 * @param color the RGBA tuple written to every pixel.
 * @returns the freshly allocated pixel buffer.
 */
export function solidRgba(
	width: number,
	height: number,
	color: readonly [number, number, number, number],
): Uint8Array {
	/** The pixel buffer being filled. */
	const rgba = new Uint8Array(width * height * RGBA_CHANNELS)
	for (let pixel = 0; pixel < width * height; pixel++) {
		/** Byte offset of the current pixel. */
		const offset = pixel * RGBA_CHANNELS
		rgba[offset] = color[0]
		rgba[offset + 1] = color[1]
		rgba[offset + 2] = color[2]
		rgba[offset + 3] = color[3]
	}
	return rgba
}
