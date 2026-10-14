/** A decoded raster image: 8-bit RGBA samples, row-major, four bytes per pixel. */
export interface DecodedImage {
	/** Width in pixels. */
	readonly width: number
	/** Height in pixels. */
	readonly height: number
	/** Row-major RGBA samples, four bytes per pixel, so the length is width * height * 4. */
	readonly rgba: Uint8Array
	/** Whether the source PNG carried an alpha channel (colour type 4 or 6). */
	readonly hasAlphaChannel: boolean
	/** Whether at least one decoded pixel has alpha below 255. */
	readonly hasTransparentPixels: boolean
}

/** One differing grid cell, reported both in grid coordinates and in overlap pixels. */
export interface Hotspot {
	/** Cell column in the diff grid, 0-based. */
	readonly gridX: number
	/** Cell row in the diff grid, 0-based. */
	readonly gridY: number
	/** Left edge of the cell in overlap pixels. */
	readonly x: number
	/** Top edge of the cell in overlap pixels. */
	readonly y: number
	/** Cell width in overlap pixels, at least 1. */
	readonly width: number
	/** Cell height in overlap pixels, at least 1. */
	readonly height: number
	/** Share of the cell's compared pixels that differ, rounded to four decimals. */
	readonly diffRatio: number
}

/** Pixel dimensions of one image, as reported inside a verdict. */
export interface ImageDimensions {
	/** Width in pixels. */
	readonly width: number
	/** Height in pixels. */
	readonly height: number
}

/** The JSON verdict of the `image-diff` command. */
export interface ImageDiffResult {
	/** Discriminant naming the command that produced this verdict. */
	readonly command: "image-diff"
	/** Whether both images have the same width and height. */
	readonly dimensionsMatch: boolean
	/** Dimensions of the reference image. */
	readonly reference: ImageDimensions
	/** Dimensions of the image under test. */
	readonly actual: ImageDimensions
	/** Pixels compared, i.e. the area of the region both images cover. */
	readonly totalPixels: number
	/** Compared pixels that differ in at least one RGBA channel. */
	readonly diffPixels: number
	/** diffPixels / totalPixels rounded to four decimals; 0 when nothing overlapped. */
	readonly diffRatio: number
	/** Integer percentage similarity, round((1 - diffRatio) * 100). */
	readonly similarityScore: number
	/** False only when the reference had transparent pixels and the actual has none. */
	readonly alphaChannelIntact: boolean
	/** Differing grid cells, ranked by diff ratio descending. */
	readonly hotspots: readonly Hotspot[]
	/** One-line human summary of the verdict. */
	readonly summary: string
}

/** A capture line whose measured width exceeds the expected column count. */
export interface OverflowLine {
	/** 1-based line number inside the capture. */
	readonly line: number
	/** Measured column width of that line. */
	readonly width: number
}

/** The JSON verdict of the `tui-check` command. */
export interface TuiCheckResult {
	/** Discriminant naming the command that produced this verdict. */
	readonly command: "tui-check"
	/** Column count the capture was checked against, taken from `--cols`. */
	readonly expectedColumns: number
	/** Lines measured; a single trailing newline does not add a line. */
	readonly lineCount: number
	/** Measured column width per line, in capture order. */
	readonly lineWidths: readonly number[]
	/** Widest measured line, 0 for an empty capture. */
	readonly maxWidth: number
	/** Lines wider than expectedColumns, in capture order. */
	readonly overflowLines: readonly OverflowLine[]
	/** True when the box-drawing lines disagree on width, i.e. the frame is not rectangular. */
	readonly borderMisaligned: boolean
	/** Columns where a double-width character starts, deduplicated, sorted and capped at 64 entries. */
	readonly wideCharColumns: readonly number[]
	/** Whether the raw capture text contains ANSI escape sequences. */
	readonly hasAnsi: boolean
	/** One-line human summary of the verdict. */
	readonly summary: string
}
