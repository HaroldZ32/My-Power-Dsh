import type { DecodedImage, Hotspot, ImageDiffResult } from "./types"

/** Maximum cells per axis in the hotspot grid; smaller overlaps use fewer cells. */
const GRID_SIZE = 8

/** Round to four decimal places so the ratios and the similarity score are stable in the JSON verdict. */
function round4(value: number): number {
	return Math.round(value * 10000) / 10000
}

/** Whether two RGBA pixels differ in any of their four channels; both offsets are byte offsets into their buffers. */
function pixelsDiffer(ref: Uint8Array, refOffset: number, act: Uint8Array, actOffset: number): boolean {
	return (
		ref[refOffset] !== act[actOffset] ||
		ref[refOffset + 1] !== act[actOffset + 1] ||
		ref[refOffset + 2] !== act[actOffset + 2] ||
		ref[refOffset + 3] !== act[actOffset + 3]
	)
}

/**
 * Rank the differing grid cells by how much of each cell changed.
 *
 * @param cellDiff differing-pixel count per cell, row-major.
 * @param cellTotal compared-pixel count per cell, row-major.
 * @param cols grid columns.
 * @param rows grid rows.
 * @param overlapWidth width of the region both images cover, in pixels.
 * @param overlapHeight height of the region both images cover, in pixels.
 * @returns the non-empty cells, highest diff ratio first, with pixel-space bounds.
 */
function buildHotspots(
	cellDiff: readonly number[],
	cellTotal: readonly number[],
	cols: number,
	rows: number,
	overlapWidth: number,
	overlapHeight: number,
): Hotspot[] {
	/** Accumulator for the ranked cells. */
	const hotspots: Hotspot[] = []
	for (let gridY = 0; gridY < rows; gridY++) {
		for (let gridX = 0; gridX < cols; gridX++) {
			/** Flat index of this cell in the row-major diff and total arrays. */
			const index = gridY * cols + gridX
			/** Differing pixels recorded for this cell. */
			const diff = cellDiff[index] ?? 0
			/** Pixels compared in this cell; 0 means the cell was never sampled. */
			const total = cellTotal[index] ?? 0
			if (diff === 0 || total === 0) continue
			/** Left edge of the cell in overlap pixels. */
			const left = Math.floor((gridX * overlapWidth) / cols)
			/** Right edge of the cell in overlap pixels, exclusive. */
			const right = Math.floor(((gridX + 1) * overlapWidth) / cols)
			/** Top edge of the cell in overlap pixels. */
			const top = Math.floor((gridY * overlapHeight) / rows)
			/** Bottom edge of the cell in overlap pixels, exclusive. */
			const bottom = Math.floor(((gridY + 1) * overlapHeight) / rows)
			hotspots.push({
				gridX,
				gridY,
				x: left,
				y: top,
				width: right - left,
				height: bottom - top,
				diffRatio: round4(diff / total),
			})
		}
	}
	hotspots.sort((a, b) => b.diffRatio - a.diffRatio)
	return hotspots
}

/**
 * Compose the one-line human summary of a diff verdict.
 *
 * @param similarityScore integer similarity percentage.
 * @param diffPixels compared pixels that differ.
 * @param totalPixels pixels compared.
 * @param dimensionsMatch whether both images have the same dimensions.
 * @param hotspotCount number of reported hotspot cells.
 * @returns the summary sentence shown in the verdict.
 */
function buildSummary(
	similarityScore: number,
	diffPixels: number,
	totalPixels: number,
	dimensionsMatch: boolean,
	hotspotCount: number,
): string {
	/** Summary fragments, joined in a fixed order so the sentence is deterministic. */
	const parts = [`${similarityScore}/100 similarity`, `${diffPixels}/${totalPixels} pixels differ`]
	if (!dimensionsMatch) parts.push("dimensions differ")
	if (hotspotCount > 0) parts.push(`${hotspotCount} hotspot region(s)`)
	return `${parts.join("; ")}.`
}

/** Compare the overlapping region of two decoded images and produce the full verdict: pixel counters, rounded metrics, grid hotspots and the summary line. */
export function diffImages(reference: DecodedImage, actual: DecodedImage): ImageDiffResult {
	/** Width of the region both images cover. */
	const overlapWidth = Math.min(reference.width, actual.width)
	/** Height of the region both images cover. */
	const overlapHeight = Math.min(reference.height, actual.height)
	/** Pixels compared, i.e. the overlap area. */
	const totalPixels = overlapWidth * overlapHeight
	/** Hotspot grid columns, never more than {@link GRID_SIZE} or the overlap width. */
	const cols = Math.max(1, Math.min(GRID_SIZE, overlapWidth))
	/** Hotspot grid rows, never more than {@link GRID_SIZE} or the overlap height. */
	const rows = Math.max(1, Math.min(GRID_SIZE, overlapHeight))
	/** Differing-pixel count per grid cell, row-major. */
	const cellDiff = new Array<number>(cols * rows).fill(0)
	/** Compared-pixel count per grid cell, row-major. */
	const cellTotal = new Array<number>(cols * rows).fill(0)

	/** Running count of differing pixels. */
	let diffPixels = 0
	for (let y = 0; y < overlapHeight; y++) {
		/** Grid row this image row maps into. */
		const cellY = Math.min(rows - 1, Math.floor((y * rows) / overlapHeight))
		for (let x = 0; x < overlapWidth; x++) {
			/** Grid column this image column maps into. */
			const cellX = Math.min(cols - 1, Math.floor((x * cols) / overlapWidth))
			/** Flat index of the mapped cell. */
			const cellIndex = cellY * cols + cellX
			cellTotal[cellIndex] = (cellTotal[cellIndex] ?? 0) + 1
			/** Byte offset of this pixel in the reference RGBA buffer. */
			const refOffset = (y * reference.width + x) * 4
			/** Byte offset of this pixel in the actual RGBA buffer. */
			const actOffset = (y * actual.width + x) * 4
			if (pixelsDiffer(reference.rgba, refOffset, actual.rgba, actOffset)) {
				diffPixels++
				cellDiff[cellIndex] = (cellDiff[cellIndex] ?? 0) + 1
			}
		}
	}

	/** Fraction of compared pixels that differ; 0 when the images do not overlap at all. */
	const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels
	/** Integer similarity percentage derived from {@link diffRatio}. */
	const similarityScore = Math.round((1 - diffRatio) * 100)
	/** Grid cells that differ, ranked by diff ratio. */
	const hotspots = buildHotspots(cellDiff, cellTotal, cols, rows, overlapWidth, overlapHeight)
	/** Whether the two images have identical dimensions. */
	const dimensionsMatch = reference.width === actual.width && reference.height === actual.height
	/** The verdict's alpha field, a whole-image flag: false only when the reference has transparent pixels anywhere and the actual has none. */
	const alphaChannelIntact = !(reference.hasTransparentPixels && !actual.hasTransparentPixels)

	return {
		command: "image-diff",
		dimensionsMatch,
		reference: { width: reference.width, height: reference.height },
		actual: { width: actual.width, height: actual.height },
		totalPixels,
		diffPixels,
		diffRatio: round4(diffRatio),
		similarityScore,
		alphaChannelIntact,
		hotspots,
		summary: buildSummary(similarityScore, diffPixels, totalPixels, dimensionsMatch, hotspots.length),
	}
}
