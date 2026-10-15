/**
 * Minimal PNG decoder for screenshots (8-bit RGB/RGBA, non-interlaced — what
 * Chromium writes). Enough to detect blank renders and diff two shots without a
 * dependency. Returns undefined for formats it does not handle.
 */
export interface Bitmap {
    width: number;
    height: number;
    channels: 3 | 4;
    data: Uint8Array;
}
export declare function decodePng(buffer: Buffer): Bitmap | undefined;
/** Number of distinct colours, counting up to `limit` (a blank render has 1). */
export declare function distinctColors(bitmap: Bitmap, limit?: number): number;
/** Share of pixels that differ (any channel by more than `tolerance`); 1 when sizes differ. */
export declare function diffRatio(a: Bitmap, b: Bitmap, tolerance?: number): number;
