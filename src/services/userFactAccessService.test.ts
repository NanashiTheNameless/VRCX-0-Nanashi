import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
    appIngestUserFacts: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: tauriMock
}));

import {
    flushPendingUserFactEntries,
    ingestUserFactEntries,
    resetPendingUserFactEntries
} from './userFactAccessService';

describe('userFactAccessService', () => {
    beforeEach(() => {
        resetPendingUserFactEntries();
        tauriMock.appIngestUserFacts.mockReset();
        tauriMock.appIngestUserFacts.mockResolvedValue(undefined);
    });

    it('batches one tick while merging only equivalent user sources', async () => {
        ingestUserFactEntries([
            {
                user: {
                    id: 'usr_target',
                    displayName: 'Target',
                    tags: ['system_trust_known']
                },
                source: 'profile'
            }
        ]);
        ingestUserFactEntries([
            {
                user: {
                    id: 'usr_target',
                    displayName: '',
                    currentAvatarImageUrl: 'https://example.test/avatar.png',
                    tags: []
                },
                source: 'profile'
            },
            {
                user: { id: 'usr_target', location: 'wrld_live:123' },
                source: 'realtime',
                isFriend: true
            }
        ]);

        await flushPendingUserFactEntries();

        expect(tauriMock.appIngestUserFacts).toHaveBeenCalledTimes(1);
        expect(tauriMock.appIngestUserFacts).toHaveBeenCalledWith([
            {
                user: {
                    id: 'usr_target',
                    displayName: 'Target',
                    currentAvatarImageUrl: 'https://example.test/avatar.png',
                    tags: ['system_trust_known']
                },
                source: 'profile'
            },
            {
                user: { id: 'usr_target', location: 'wrld_live:123' },
                source: 'realtime',
                isFriend: true
            }
        ]);
    });

    it('keeps an empty tags array when it is the only value to ingest', async () => {
        ingestUserFactEntries([
            {
                user: { id: 'usr_target', tags: [] },
                source: 'profile'
            }
        ]);

        await flushPendingUserFactEntries();

        expect(tauriMock.appIngestUserFacts).toHaveBeenCalledWith([
            {
                user: { id: 'usr_target', tags: [] },
                source: 'profile'
            }
        ]);
    });

    it('keeps manual observations separate from background facts and other account scopes', async () => {
        const entries = [
            {
                user: { id: 'usr_target', bio: 'background' },
                source: 'profile'
            },
            {
                user: { id: 'usr_target', bio: 'manual' },
                source: 'profile',
                manualProfileHistory: true,
                ownerUserId: 'usr_owner',
                endpoint: 'api'
            },
            {
                user: { id: 'usr_target', bio: 'other account' },
                source: 'profile',
                manualProfileHistory: true,
                ownerUserId: 'usr_other',
                endpoint: 'api'
            }
        ];
        ingestUserFactEntries(entries);
        await flushPendingUserFactEntries();
        expect(tauriMock.appIngestUserFacts).toHaveBeenCalledWith(entries);
    });

    it('keeps cleared badge fields when batching profile updates', async () => {
        ingestUserFactEntries([
            {
                source: 'profile',
                user: {
                    id: 'usr_target',
                    ageVerified: true,
                    ageVerificationStatus: '18+',
                    bio: 'An artist',
                    pronouns: 'they/them',
                    memo: 'Local friend memo',
                    note: 'VRChat note'
                }
            },
            {
                source: 'profile',
                user: {
                    id: 'usr_target',
                    ageVerified: false,
                    ageVerificationStatus: null,
                    bio: '',
                    pronouns: null,
                    memo: '',
                    note: ''
                }
            }
        ]);
        await flushPendingUserFactEntries();
        expect(tauriMock.appIngestUserFacts).toHaveBeenCalledWith([
            {
                source: 'profile',
                user: {
                    id: 'usr_target',
                    ageVerified: false,
                    ageVerificationStatus: null,
                    bio: '',
                    pronouns: null,
                    memo: '',
                    note: ''
                }
            }
        ]);
    });
});
