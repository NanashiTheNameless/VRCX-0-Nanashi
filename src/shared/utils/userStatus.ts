import { presenceOf, presenceStatusKey } from '@/domain/friends/presence';

type UserStatusSource = Record<string, unknown>;

type UserStatusIndicatorOptions = {
    showOffline?: boolean;
    className?: string;
};

type TranslateFn = (
    key: string,
    options?: {
        defaultValue: string;
    }
) => string;

function asUserStatusSource(value: unknown): UserStatusSource {
    return value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

function normalizePresenceText(value: unknown) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (normalized === 'joinme') {
        return 'join me';
    }
    if (normalized === 'askme') {
        return 'ask me';
    }
    if (normalized === 'offline:offline' || normalized.startsWith('offline ')) {
        return 'offline';
    }
    if (normalized === 'private:private') {
        return 'private';
    }
    if (normalized === 'traveling:traveling') {
        return 'traveling';
    }
    return normalized;
}

function resolveUserPresenceStatus(value: unknown) {
    if (typeof value === 'string') {
        return normalizePresenceText(value);
    }
    const record = asUserStatusSource(value);
    const presence = presenceOf(record);
    return presence
        ? presenceStatusKey(presence, record.status)
        : normalizePresenceText(record.status);
}

function userStatusIndicatorClassName(
    value: unknown,
    { showOffline = false, className = '' }: UserStatusIndicatorOptions = {}
) {
    const status = resolveUserPresenceStatus(value);
    const classes = ['x-user-status'];

    if (status === 'state-active') {
        classes.push('active');
    } else if (status === 'active') {
        classes.push('online');
    } else if (status === 'join me') {
        classes.push('joinme');
    } else if (status === 'ask me') {
        classes.push('askme');
    } else if (status === 'busy') {
        classes.push('busy');
    } else if (showOffline && status === 'offline') {
        classes.push('offline');
    } else {
        return '';
    }

    if (className) {
        classes.push(className);
    }

    return classes.join(' ');
}

function userStatusSortRank(value: unknown) {
    const status = resolveUserPresenceStatus(value);
    if (status === 'join me') {
        return 0;
    }
    if (status === 'active') {
        return 1;
    }
    if (status === 'ask me') {
        return 2;
    }
    if (status === 'busy') {
        return 3;
    }
    if (status === 'offline') {
        return 5;
    }
    return 4;
}

const statusLabelKeys: Readonly<Record<string, string>> = Object.freeze({
    active: 'dialog.user.status.online',
    'state-active': 'dialog.user.status.active',
    'join me': 'dialog.user.status.join_me',
    'ask me': 'dialog.user.status.ask_me',
    busy: 'dialog.user.status.busy',
    offline: 'dialog.user.status.offline',
    private: 'location.private',
    traveling: 'location.traveling'
});

const statusLabelFallbacks: Readonly<Record<string, string>> = Object.freeze({
    active: 'Online',
    'state-active': 'Active',
    'join me': 'Join Me',
    'ask me': 'Ask Me',
    busy: 'Do Not Disturb',
    offline: 'Offline',
    private: 'Private',
    traveling: 'Traveling'
});

function labelStatus(value: unknown) {
    const status = resolveUserPresenceStatus(value);
    return status !== 'offline' && presenceOf(value)?.kind === 'active'
        ? 'state-active'
        : status;
}

function userStatusLabelKey(value: unknown): string {
    return statusLabelKeys[labelStatus(value)] ?? '';
}

function userStatusLabel(value: unknown, t?: TranslateFn) {
    const status = labelStatus(value);
    if (!status) {
        return '';
    }
    const labelKey = statusLabelKeys[status];
    const fallback = statusLabelFallbacks[status] || status;
    if (!labelKey || typeof t !== 'function') {
        return fallback;
    }
    return t(labelKey, { defaultValue: fallback });
}

export {
    resolveUserPresenceStatus,
    userStatusIndicatorClassName,
    userStatusLabel,
    userStatusLabelKey,
    userStatusSortRank
};
