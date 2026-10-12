import { formatDateTime } from '@/lib/dateTime';
import {
    commands,
    type FeedLoggerSettingsView,
    type FeedLoggerStatus
} from '@/platform/tauri/bindings';
import type { ProfileBackupSettings } from '@/services/profileBackupService';

export type RunAction = (action: () => Promise<unknown>) => Promise<void>;

export type SetupStep = 1 | 2 | 3 | 4;

export const SETUP_STEPS = 4;

export function runThenRefreshStatus(
    run: RunAction,
    action: () => Promise<unknown>
) {
    return run(async () => {
        await action();
        await commands.appFeedLoggerStatus();
    });
}

export function formatUnixTime(seconds: number | null) {
    if (seconds === null) {
        return '-';
    }
    return formatDateTime(new Date(seconds * 1000).toISOString(), {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

export function isAutomaticBackupReady(
    backup: ProfileBackupSettings | null
): boolean {
    return Boolean(backup?.autoEnabled && backup.autoTargetDir);
}

export function resolveSetupStep(
    settings: FeedLoggerSettingsView | null,
    backupReady: boolean,
    status: FeedLoggerStatus | null
): SetupStep | null {
    if (settings && !settings.address) {
        return backupReady ? 2 : 1;
    }
    const session = status?.session.state;
    if (
        session === 'noCredentials' ||
        session === 'loginFailed' ||
        session === 'awaitingTwoFactor'
    ) {
        return 4;
    }
    return null;
}
