import {
    commands,
    type DataDirCleanupReport,
    type DataDirMigrationActionOutcome,
    type DataDirMigrationMode,
    type DataDirMigrationPlan,
    type DataDirMigrationResult
} from '@/platform/tauri/bindings';
import { epochSecondsFromValue } from '@/shared/utils/displayTimeZone';

export type {
    DataDirCleanupPending,
    DataDirCleanupReport,
    DataDirMigrationActionOutcome,
    DataDirMigrationErrorCode,
    DataDirMigrationMode,
    DataDirMigrationPhase,
    DataDirMigrationPlan,
    DataDirMigrationResult,
    DataDirMigrationStatus,
    DataDirMigrationWarning
} from '@/platform/tauri/bindings';

export function planDataDirMigration(
    path: string
): Promise<DataDirMigrationPlan> {
    return commands.appPlanDataDirMigration(path);
}

export function requestDataDirMigration(
    path: string,
    mode: DataDirMigrationMode
): Promise<DataDirMigrationActionOutcome> {
    return commands.appRequestDataDirMigration(path, mode);
}

export function cancelDataDirMigration(): Promise<DataDirMigrationActionOutcome> {
    return commands.appCancelDataDirMigration();
}

export function takeDataDirMigrationResult(): Promise<DataDirMigrationResult | null> {
    return commands.appTakeDataDirMigrationResult();
}

export function cleanupMigratedDataDir(): Promise<DataDirCleanupReport | null> {
    return commands.appCleanupMigratedDataDir();
}

export async function dismissDataDirCleanup(): Promise<void> {
    await commands.appDismissDataDirCleanup();
}

export async function markDataDirCleanupPrompted(
    promptedAt: number | string
): Promise<void> {
    await commands.appMarkDataDirCleanupPrompted(
        epochSecondsFromValue(promptedAt) ?? 0
    );
}
