type Rgba = [number, number, number, number];

const FALLBACK_RGBA: Rgba = [148, 163, 184, 1];

function parseHex(value: string): Rgba | null {
    const hex = value.slice(1);
    if (hex.length === 3) {
        return [
            parseInt(hex[0] + hex[0], 16),
            parseInt(hex[1] + hex[1], 16),
            parseInt(hex[2] + hex[2], 16),
            1
        ];
    }
    if (hex.length === 6 || hex.length === 8) {
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
        ];
    }
    return null;
}

function parseGraphColor(value: string): Rgba {
    const input = value.trim();
    if (input.startsWith('#')) {
        return parseHex(input) ?? FALLBACK_RGBA;
    }
    const match = input.match(/rgba?\(([^)]+)\)/i);
    if (!match) {
        return FALLBACK_RGBA;
    }
    const parts = match[1]
        .split(/[,/\s]+/)
        .map((part) => Number.parseFloat(part))
        .filter((part) => Number.isFinite(part));
    if (parts.length < 3) {
        return FALLBACK_RGBA;
    }
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

export function mixGraphColors(from: string, to: string, progress: number) {
    const ratio = Math.max(0, Math.min(1, progress));
    const source = parseGraphColor(from);
    const target = parseGraphColor(to);
    const channel = (index: number) =>
        Math.round(source[index] + (target[index] - source[index]) * ratio);
    const alpha = source[3] + (target[3] - source[3]) * ratio;
    return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
}
