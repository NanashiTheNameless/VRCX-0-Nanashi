import { userStatusDotClassName } from '@/domain/friends/presence';
import { normalizeProfileLanguageRows } from '@/shared/utils/userLanguage';
import type { LanguageOption } from '@/shared/utils/userLanguage';
import { userStatusSortRank } from '@/shared/utils/userStatus';

export function languageCodeLabel(languageKey: string) {
    const key = languageKey
        .trim()
        .toLowerCase()
        .replace(/^language_/, '');
    return key ? key.toUpperCase() : '';
}

export function languageTooltipLabel(entry: LanguageOption, code: string) {
    const value = String(
        entry?.value || entry?.label || entry?.name || ''
    ).trim();
    return value || code;
}

export function resolveFriendLanguageRows(friend: unknown) {
    return normalizeProfileLanguageRows(friend);
}

function resolveFriendStatusLabel(friend: unknown) {
    if (!friend || typeof friend !== 'object') {
        return '';
    }
    const record = Object.fromEntries(Object.entries(friend));
    return String(record.statusDescription ?? '').trim();
}

export function resolveFriendStatusMeta(friend: unknown) {
    return {
        badgeVariant: 'outline',
        statusDotClassName: userStatusDotClassName(friend),
        label: resolveFriendStatusLabel(friend),
        sortRank: userStatusSortRank(friend || 'offline')
    };
}
