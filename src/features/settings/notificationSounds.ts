import { isRecord } from '@/shared/utils/record';

export interface NotificationSoundRule {
    enabled: boolean;
    path: string;
    volume: number;
}

export interface NotificationSounds {
    version: 1;
    rules: Record<string, NotificationSoundRule>;
}

// Refuse malformed/unsupported settings rather than silently overwriting them.
export function parseNotificationSounds(raw: string): NotificationSounds {
    if (!raw) return { version: 1, rules: {} };
    const value: unknown = JSON.parse(raw);
    if (
        !isRecord(value) ||
        (value.version !== undefined && value.version !== 1) ||
        !isRecord(value.rules)
    ) {
        throw new Error('Invalid notification sound settings');
    }
    const rules = Object.fromEntries(
        Object.entries(value.rules).map(([key, rule]) => {
            if (
                !isRecord(rule) ||
                (rule.enabled !== undefined &&
                    typeof rule.enabled !== 'boolean') ||
                (rule.path !== undefined && typeof rule.path !== 'string') ||
                (rule.volume !== undefined &&
                    (typeof rule.volume !== 'number' ||
                        !Number.isFinite(rule.volume)))
            ) {
                throw new Error('Invalid notification sound rule');
            }
            return [
                key,
                {
                    enabled: rule.enabled ?? true,
                    path: rule.path ?? '',
                    volume: Math.max(0, Math.min(1, rule.volume ?? 0.8))
                }
            ];
        })
    );
    return { version: 1, rules };
}
