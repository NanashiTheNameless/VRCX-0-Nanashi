import { create } from 'zustand';

import {
    CUSTOM_BADGE_LABEL_MAX,
    DEFAULT_CUSTOM_BADGE_COLOR,
    isReservedBadgeIcon,
    type CustomBadge
} from '@/domain/badges/customBadges';
import type { VrcxCustomTag } from '@/platform/tauri/bindings';

export const VRCX_TAG_BADGE_ICON = 'Tag';

// Tags other programs send over the VRCX IPC pipe, drawn as custom badges.
// The backend keeps them in memory only, like VRCX, and sends the full list on
// every change.
interface VrcxCustomTagStoreState {
    tagsByUserId: Record<string, VrcxCustomTag[]>;
    setTags(tags: VrcxCustomTag[]): void;
}

const NO_TAGS: VrcxCustomTag[] = [];

export const useVrcxCustomTagStore = create<VrcxCustomTagStoreState>((set) => ({
    tagsByUserId: {},
    setTags(tags) {
        const tagsByUserId: Record<string, VrcxCustomTag[]> = {};
        for (const tag of tags) {
            if (tag.tag.trim()) {
                (tagsByUserId[tag.userId] ??= []).push(tag);
            }
        }
        set({ tagsByUserId });
    }
}));

export function useVrcxCustomTags(
    userId: string | null | undefined
): VrcxCustomTag[] {
    return useVrcxCustomTagStore((state) =>
        userId ? (state.tagsByUserId[userId] ?? NO_TAGS) : NO_TAGS
    );
}

// Programs send any CSS color VRCX accepts. Badges need #rrggbb, so turn
// short hex, hex with alpha and (where a canvas exists) named or rgb() colors
// into that, and use the default badge color for anything else.
export function vrcxCustomTagHexColor(colour: string): string {
    const value = colour.trim();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(value);
    if (short) {
        return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
    }
    const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
    if (long) {
        return `#${long[1]}`.toLowerCase();
    }
    if (value && typeof document !== 'undefined') {
        const context = document.createElement('canvas').getContext('2d');
        if (context) {
            context.fillStyle = '#000001';
            context.fillStyle = value;
            const resolved = String(context.fillStyle);
            if (/^#[0-9a-f]{6}$/i.test(resolved) && resolved !== '#000001') {
                return resolved.toLowerCase();
            }
        }
    }
    return DEFAULT_CUSTOM_BADGE_COLOR;
}

const ICON_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

// Any icon a custom badge may use, Lucide Lab ones included; reserved icons
// and names that are not icon names get the tag icon instead.
export function vrcxCustomTagIcon(icon: string): string {
    const name = icon.trim();
    return ICON_NAME.test(name) && !isReservedBadgeIcon(name)
        ? name
        : VRCX_TAG_BADGE_ICON;
}

/**
 * An IPC tag drawn as a custom badge: round, visible only to this user, with
 * the tag text as its label. It has no rules; the program decides who has it.
 */
export function vrcxCustomTagBadge(tag: VrcxCustomTag): CustomBadge {
    return {
        id: `vrcx-ipc:${tag.userId}:${tag.id}`,
        label: tag.tag.trim().slice(0, CUSTOM_BADGE_LABEL_MAX),
        icon: vrcxCustomTagIcon(tag.icon),
        color: vrcxCustomTagHexColor(tag.colour),
        enabled: true,
        rules: []
    };
}
