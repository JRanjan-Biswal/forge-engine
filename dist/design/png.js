import { inflateSync } from "node:zlib";
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export function decodePng(buffer) {
    if (buffer.length < 33 || SIGNATURE.some((byte, i) => buffer[i] !== byte))
        return undefined;
    let offset = 8;
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            const bitDepth = body[8];
            const colorType = body[9];
            const interlace = body[12];
            if (bitDepth !== 8 || interlace !== 0)
                return undefined;
            channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
            if (!channels)
                return undefined;
        }
        else if (type === "IDAT") {
            idat.push(body);
        }
        else if (type === "IEND") {
            break;
        }
        offset += 12 + length;
    }
    if (!width || !height || !channels || !idat.length)
        return undefined;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < height * (stride + 1))
        return undefined;
    const data = new Uint8Array(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const lineStart = y * (stride + 1) + 1;
        const out = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? (data[out + x - channels] ?? 0) : 0;
            const b = y > 0 ? (data[out - stride + x] ?? 0) : 0;
            const c = x >= channels && y > 0 ? (data[out - stride + x - channels] ?? 0) : 0;
            let predicted = 0;
            if (filter === 1)
                predicted = a;
            else if (filter === 2)
                predicted = b;
            else if (filter === 3)
                predicted = (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            else if (filter !== 0)
                return undefined;
            data[out + x] = ((raw[lineStart + x] ?? 0) + predicted) & 0xff;
        }
    }
    return { width, height, channels, data };
}
/** Number of distinct colours, counting up to `limit` (a blank render has 1). */
export function distinctColors(bitmap, limit = 16) {
    const seen = new Set();
    const { data, channels } = bitmap;
    for (let i = 0; i < data.length && seen.size < limit; i += channels) {
        seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return seen.size;
}
/** Share of pixels that differ (any channel by more than `tolerance`); 1 when sizes differ. */
export function diffRatio(a, b, tolerance = 8) {
    if (a.width !== b.width || a.height !== b.height)
        return 1;
    let changed = 0;
    const pixels = a.width * a.height;
    for (let p = 0; p < pixels; p++) {
        const ia = p * a.channels;
        const ib = p * b.channels;
        for (let k = 0; k < 3; k++) {
            if (Math.abs((a.data[ia + k] ?? 0) - (b.data[ib + k] ?? 0)) > tolerance) {
                changed++;
                break;
            }
        }
    }
    return changed / pixels;
}
