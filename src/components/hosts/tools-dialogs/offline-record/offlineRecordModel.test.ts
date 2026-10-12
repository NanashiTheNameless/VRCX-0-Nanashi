import { describe, expect, it } from 'vitest';

import type { FeedLoggerSession } from '@/platform/tauri/bindings';
import { recorderStatus } from '@/test/offlineRecordFixtures';

import { isAutomaticBackupReady, resolveSetupStep } from './offlineRecordModel';

const noRecorder = { address: null, savedCredentialsAvailable: false };
const savedRecorder = {
    address: 'http://127.0.0.1:8787',
    savedCredentialsAvailable: false
};

describe('setup step to show', () => {
    it('counts automatic backups as ready only when they are on and have a folder', () => {
        const backup = {
            autoEnabled: true,
            autoIntervalDays: 7,
            autoRetainExtra: 2,
            autoTargetDir: 'D:/Backups',
            lastAutoAt: null
        };

        expect(isAutomaticBackupReady(backup)).toBe(true);
        expect(isAutomaticBackupReady({ ...backup, autoEnabled: false })).toBe(
            false
        );
        expect(isAutomaticBackupReady({ ...backup, autoTargetDir: '' })).toBe(
            false
        );
        expect(isAutomaticBackupReady(null)).toBe(false);
    });

    it('starts at backups, then the address, while no recorder is saved', () => {
        expect(resolveSetupStep(noRecorder, false, null)).toBe(1);
        expect(resolveSetupStep(noRecorder, true, null)).toBe(2);
    });

    it.each([
        { state: 'noCredentials' },
        { state: 'loginFailed', reason: 'bad password' },
        { state: 'awaitingTwoFactor', methods: ['totp'] }
    ] satisfies FeedLoggerSession[])(
        'returns to the VRChat login step while the recorder is $state',
        (session) => {
            expect(
                resolveSetupStep(
                    savedRecorder,
                    true,
                    recorderStatus({ session })
                )
            ).toBe(4);
        }
    );

    it.each([
        { state: 'recording' },
        { state: 'loggingIn' },
        { state: 'reconnecting' }
    ] satisfies FeedLoggerSession[])(
        'leaves setup once the recorder is $state',
        (session) => {
            expect(
                resolveSetupStep(
                    savedRecorder,
                    true,
                    recorderStatus({ session })
                )
            ).toBeNull();
        }
    );

    it('leaves setup while a saved recorder cannot report its status', () => {
        expect(resolveSetupStep(savedRecorder, false, null)).toBeNull();
    });
});
