import {
    defaultEmojiName,
    defaultEmojiPreviewUrl
} from '@/shared/constants/vrchatDefaultEmojis';
import { isRecord } from '@/shared/utils/record';

const BOOP_EMOJI_KINDS = ['default', 'file', 'inventory'] as const;

type BoopEmojiKind = (typeof BOOP_EMOJI_KINDS)[number];

export interface BoopEmojiChoice {
    kind: BoopEmojiKind;
    id: string;
    imageUrl: string;
    name: string;
}

export interface BoopEmojiSendParams {
    emojiId: string;
    inventoryItemId: string;
}

function isBoopEmojiKind(value: unknown): value is BoopEmojiKind {
    return (
        typeof value === 'string' &&
        BOOP_EMOJI_KINDS.some((kind) => kind === value)
    );
}

export function isSameBoopEmoji(
    left: BoopEmojiChoice | null,
    right: BoopEmojiChoice
): boolean {
    return left !== null && left.kind === right.kind && left.id === right.id;
}

export function toBoopEmojiSendParams(
    choice: BoopEmojiChoice | null
): BoopEmojiSendParams {
    if (!choice) {
        return { emojiId: '', inventoryItemId: '' };
    }
    return choice.kind === 'inventory'
        ? { emojiId: '', inventoryItemId: choice.id }
        : { emojiId: choice.id, inventoryItemId: '' };
}

export function parseBoopEmojiChoice(value: unknown): BoopEmojiChoice | null {
    if (!isRecord(value) || !isBoopEmojiKind(value.kind)) {
        return null;
    }
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) {
        return null;
    }
    if (value.kind === 'default') {
        const imageUrl = defaultEmojiPreviewUrl(id);
        return imageUrl
            ? { kind: 'default', id, imageUrl, name: defaultEmojiName(id) }
            : null;
    }
    const imageUrl =
        typeof value.imageUrl === 'string' ? value.imageUrl.trim() : '';
    if (!imageUrl) {
        return null;
    }
    return {
        kind: value.kind,
        id,
        imageUrl,
        name: typeof value.name === 'string' ? value.name : ''
    };
}
