import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

import { getColourFromUserID } from './colour';

type LooseRecord = Record<string, unknown>;

export type ImageUser = LooseRecord & {
    iconUrl?: string | null;
};

const VRCHAT_IMAGE_FILE_PATTERN =
    /(?:file\/(file_[a-f0-9-]+)\/(\d+)(?:\/file)?|image\/(file_[a-f0-9-]+)\/(\d+)\/\d+)\/?$/;

export function convertFileUrlToImageUrl(
    url: string | null | undefined,
    resolution: string | number = 128,
    endpointDomain: string | null = null
) {
    if (!url) {
        return '';
    }
    const match = url.match(VRCHAT_IMAGE_FILE_PATTERN);
    if (!match) {
        return url;
    }
    const fileId = match[1] ?? match[3];
    const version = match[2] ?? match[4];
    const endpoint = normalizeVrchatEndpointDomain(endpointDomain);
    return `${endpoint}/image/${fileId}/${version}/${resolution}`;
}

function hsvToRgb(h: number, s: number, v: number) {
    let r = 0;
    let g = 0;
    let b = 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        case 5:
            r = v;
            g = p;
            b = q;
            break;
        default:
            break;
    }

    const red = Math.round(r * 255);
    const green = Math.round(g * 255);
    const blue = Math.round(b * 255);
    const decColor = 0x1000000 + blue + 0x100 * green + 0x10000 * red;
    return `#${decColor.toString(16).substr(1)}`;
}

function hueToHex(hue: number, isDarkMode: boolean) {
    if (isDarkMode) {
        return hsvToRgb(hue / 65535, 0.6, 1);
    }
    return hsvToRgb(hue / 65535, 1, 0.7);
}

export const USER_NAME_COLOUR_STYLES = [
    'classic',
    'pastel',
    'warm',
    'cool'
] as const;

export type UserNameColourStyle = (typeof USER_NAME_COLOUR_STYLES)[number];

type OklchNameColourStyle = {
    hueStart: number;
    hueSpan: number;
    dark: { lightness: number; chroma: number };
    light: { lightness: number; chroma: number };
};

const OKLCH_NAME_COLOUR_STYLES: Record<
    Exclude<UserNameColourStyle, 'classic'>,
    OklchNameColourStyle
> = {
    pastel: {
        hueStart: 0,
        hueSpan: 360,
        dark: { lightness: 0.84, chroma: 0.09 },
        light: { lightness: 0.56, chroma: 0.1 }
    },
    warm: {
        hueStart: 345,
        hueSpan: 115,
        dark: { lightness: 0.78, chroma: 0.14 },
        light: { lightness: 0.55, chroma: 0.15 }
    },
    cool: {
        hueStart: 180,
        hueSpan: 130,
        dark: { lightness: 0.76, chroma: 0.12 },
        light: { lightness: 0.52, chroma: 0.13 }
    }
};

function oklchToLinearSrgb(lightness: number, chroma: number, hue: number) {
    const radians = (hue * Math.PI) / 180;
    const a = chroma * Math.cos(radians);
    const b = chroma * Math.sin(radians);
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ];
}

function isInSrgbGamut(channels: number[]) {
    return channels.every((value) => value >= -1e-4 && value <= 1 + 1e-4);
}

function linearToSrgbByte(value: number) {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded =
        clamped <= 0.0031308
            ? 12.92 * clamped
            : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
}

function oklchToHex(lightness: number, chroma: number, hue: number) {
    let channels = oklchToLinearSrgb(lightness, chroma, hue);
    if (!isInSrgbGamut(channels)) {
        let low = 0;
        let high = chroma;
        for (let i = 0; i < 16; i++) {
            const mid = (low + high) / 2;
            if (isInSrgbGamut(oklchToLinearSrgb(lightness, mid, hue))) {
                low = mid;
            } else {
                high = mid;
            }
        }
        channels = oklchToLinearSrgb(lightness, low, hue);
    }
    return `#${channels
        .map((value) => linearToSrgbByte(value).toString(16).padStart(2, '0'))
        .join('')}`;
}

export function getNameColour(
    userId: string,
    isDarkMode: boolean,
    style: UserNameColourStyle
) {
    const hash = getColourFromUserID(userId);
    if (style === 'classic') {
        return hueToHex(hash, isDarkMode);
    }
    const { hueStart, hueSpan, dark, light } = OKLCH_NAME_COLOUR_STYLES[style];
    const { lightness, chroma } = isDarkMode ? dark : light;
    const hue = (hueStart + (hash / 65536) * hueSpan) % 360;
    return oklchToHex(lightness, chroma, hue);
}

export function userImage(
    user: ImageUser | null | undefined,
    resolution: string | number = 128,
    endpointDomain: string | null = null
) {
    return convertFileUrlToImageUrl(user?.iconUrl, resolution, endpointDomain);
}
