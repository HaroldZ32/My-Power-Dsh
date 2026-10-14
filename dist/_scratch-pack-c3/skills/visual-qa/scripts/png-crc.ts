import { Buffer } from "node:buffer"

/** The eight-byte PNG file signature: checked on decode and written verbatim on encode. */
export const PNG_SIGNATURE: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Build the 256-entry CRC-32 table for the reflected polynomial 0xedb88320. */
function buildCrcTable(): Uint32Array {
	/** The table being filled, one entry per possible leading byte. */
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		/** The running remainder for this table entry; every step keeps it in unsigned 32-bit arithmetic. */
		let c = n
		for (let k = 0; k < 8; k++) {
			c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		}
		table[n] = c >>> 0
	}
	return table
}

/** The shared CRC-32 table, built once per process. */
const CRC_TABLE = buildCrcTable()

/** CRC-32 (IEEE 802.3, reflected polynomial) of the buffer, returned as an unsigned 32-bit number. */
export function crc32(data: Buffer): number {
	/** Running CRC register, seeded with all ones and complemented on return. */
	let crc = 0xffffffff
	for (let i = 0; i < data.length; i++) {
		/** The next input byte; the fallback only guards an out-of-range read. */
		const byte = data[i] ?? 0
		/** Table entry selected by the low register byte XOR the input byte. */
		const entry = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0
		crc = entry ^ (crc >>> 8)
	}
	return (crc ^ 0xffffffff) >>> 0
}
