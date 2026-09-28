// Fork: how much the app does about updates on its own. Mirrors
// `AppUpdateMode` in crates/application/src/profile/app_update.rs; manual
// checks from the updater dialog work in every mode.
export const APP_UPDATE_MODES = [
    'Off',
    'Notify',
    'Auto Download',
    'Auto Install'
] as const;

export type AppUpdateMode = (typeof APP_UPDATE_MODES)[number];

export function isAppUpdateMode(value: unknown): value is AppUpdateMode {
    return (
        typeof value === 'string' &&
        (APP_UPDATE_MODES as readonly string[]).includes(value)
    );
}

/**
 * Stored mode, or what the legacy on/off auto-install switch becomes:
 * on -> Auto Install, off -> Notify.
 */
export function normalizeAppUpdateMode(
    value: unknown,
    legacyAutoInstall = true
): AppUpdateMode {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (isAppUpdateMode(trimmed)) {
        return trimmed;
    }
    return legacyAutoInstall ? 'Auto Install' : 'Notify';
}
