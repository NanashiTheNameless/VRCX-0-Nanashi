import type { IconNode, LucideIcon } from 'lucide-react';

// The VR overlay draws badge icons itself, from one SVG path per icon (in
// Lucide's 24 by 24 box, stroked). This turns a Lucide drawing into that.

type Attrs = Record<string, string | number | undefined>;

type IconElementOwner = {
    render?: (
        props: object,
        ref: null
    ) => { props?: { icon?: { node?: unknown } } } | null;
};

/** The drawing behind a Lucide icon component, or null if it has none. */
export function iconNodeOf(icon: LucideIcon): IconNode | null {
    try {
        const node = (icon as unknown as IconElementOwner).render?.({}, null)
            ?.props?.icon?.node;
        return Array.isArray(node) ? (node as IconNode) : null;
    } catch {
        return null;
    }
}

function num(value: string | number | undefined): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function points(value: string | number | undefined): string[] {
    const numbers = String(value ?? '')
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((entry) => fmt(num(entry)));
    const pairs: string[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
        pairs.push(`${numbers[index]} ${numbers[index + 1]}`);
    }
    return pairs;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
    if (rx <= 0 || ry <= 0) {
        return '';
    }
    const r = `${fmt(rx)} ${fmt(ry)}`;
    return (
        `M ${fmt(cx - rx)} ${fmt(cy)} ` +
        `A ${r} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} ` +
        `A ${r} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`
    );
}

function rect(attrs: Attrs): string {
    const x = num(attrs.x);
    const y = num(attrs.y);
    const width = num(attrs.width);
    const height = num(attrs.height);
    if (width <= 0 || height <= 0) {
        return '';
    }
    const rxRaw = attrs.rx ?? attrs.ry;
    const ryRaw = attrs.ry ?? attrs.rx;
    const rx = Math.min(num(rxRaw), width / 2);
    const ry = Math.min(num(ryRaw), height / 2);
    if (rx <= 0 || ry <= 0) {
        return (
            `M ${fmt(x)} ${fmt(y)} H ${fmt(x + width)} ` +
            `V ${fmt(y + height)} H ${fmt(x)} Z`
        );
    }
    const arc = `A ${fmt(rx)} ${fmt(ry)} 0 0 1`;
    return [
        `M ${fmt(x + rx)} ${fmt(y)}`,
        `H ${fmt(x + width - rx)}`,
        `${arc} ${fmt(x + width)} ${fmt(y + ry)}`,
        `V ${fmt(y + height - ry)}`,
        `${arc} ${fmt(x + width - rx)} ${fmt(y + height)}`,
        `H ${fmt(x + rx)}`,
        `${arc} ${fmt(x)} ${fmt(y + height - ry)}`,
        `V ${fmt(y + ry)}`,
        `${arc} ${fmt(x + rx)} ${fmt(y)} Z`
    ].join(' ');
}

const NUMBER = String.raw`[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?`;
const LEADING_RELATIVE_MOVE = new RegExp(
    String.raw`^m\s*(${NUMBER})\s*,?\s*(${NUMBER})\s*,?\s*`
);

// A path that starts with a relative move starts at its own origin; joined
// after another shape it would start from that shape's end instead.
function absoluteStart(d: string): string {
    const match = LEADING_RELATIVE_MOVE.exec(d);
    if (!match) {
        return d;
    }
    const rest = d.slice(match[0].length);
    // Pairs right after a move are line segments in the same (relative) mode.
    const next = /^[-+.\d]/.test(rest) ? `l ${rest}` : rest;
    return `M ${match[1]} ${match[2]} ${next}`.trim();
}

function elementPath(tag: string, attrs: Attrs): string {
    switch (tag) {
        case 'path':
            return absoluteStart(String(attrs.d ?? '').trim());
        case 'circle':
            return ellipse(
                num(attrs.cx),
                num(attrs.cy),
                num(attrs.r),
                num(attrs.r)
            );
        case 'ellipse':
            return ellipse(
                num(attrs.cx),
                num(attrs.cy),
                num(attrs.rx),
                num(attrs.ry)
            );
        case 'rect':
            return rect(attrs);
        case 'line':
            return (
                `M ${fmt(num(attrs.x1))} ${fmt(num(attrs.y1))} ` +
                `L ${fmt(num(attrs.x2))} ${fmt(num(attrs.y2))}`
            );
        case 'polyline':
        case 'polygon': {
            const pairs = points(attrs.points);
            if (pairs.length < 2) {
                return '';
            }
            const [first, ...rest] = pairs;
            return (
                `M ${first} L ${rest.join(' L ')}` +
                (tag === 'polygon' ? ' Z' : '')
            );
        }
        default:
            return '';
    }
}

/** One SVG path (24 by 24 box) drawing every shape of a Lucide icon. */
export function iconNodeToPath(node: IconNode): string {
    return node
        .map(([tag, attrs]) => elementPath(tag, attrs as Attrs))
        .filter(Boolean)
        .join(' ');
}
