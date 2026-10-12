import type {
    FeedLoggerProbe,
    FeedLoggerStatus
} from '@/platform/tauri/bindings';

export function recorderStatus(
    overrides: Partial<FeedLoggerStatus> = {}
): FeedLoggerStatus {
    return {
        loggerVersion: '2.31.0',
        protocolVersion: 1,
        startedAt: 0,
        serverTime: 0,
        session: { state: 'recording' },
        accountId: 'usr_self',
        passwordSaved: true,
        lastLoginAt: null,
        lastError: null,
        storageError: null,
        reloginAttempts: 0,
        connectedSince: null,
        lastSnapshotAt: null,
        unsyncedFrames: 0,
        oldestUnsyncedAt: null,
        newestUnsyncedAt: null,
        lastPullAt: null,
        desktopPresent: true,
        databaseBytes: 0,
        availableBytes: null,
        retentionBytes: null,
        retentionDays: null,
        droppedUnsyncedFrames: 0,
        droppedAfterPasswordChange: 0,
        webhookConfigured: false,
        webhookTarget: null,
        webhookFormat: null,
        lastWebhookAt: null,
        lastWebhookOk: null,
        ...overrides
    };
}

export function connectedRecorder(
    overrides: Partial<FeedLoggerStatus> = {}
): FeedLoggerProbe {
    return { state: 'connected', status: recorderStatus(overrides) };
}
