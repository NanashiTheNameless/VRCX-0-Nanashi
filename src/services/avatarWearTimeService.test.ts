import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

import {
    buildAvatarWearSnapshotUpdate,
    getCurrentAvatarLiveWearTime
} from './avatarWearTimeService';

describe('avatarWearTimeService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('returns non-object snapshots unchanged and clears timers while the game is stopped', () => {
        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: undefined,
                nextSnapshot: null,
                isGameRunning: true,
                now: 2000
            })
        ).toEqual({
            snapshot: null
        });

        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_old',
                    $previousAvatarSwapTime: 1000
                },
                nextSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_old'
                },
                isGameRunning: false,
                now: 2000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_old',
                $previousAvatarSwapTime: null
            }
        });
    });

    it('sets avatar swap timestamps for first avatar, unchanged avatar, and changed avatar', () => {
        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me'
                },
                nextSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_first'
                },
                isGameRunning: true,
                now: 2000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_first',
                $previousAvatarSwapTime: 2000
            }
        });

        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_same',
                    $previousAvatarSwapTime: 1000
                },
                nextSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_same'
                },
                isGameRunning: true,
                now: 2000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_same',
                $previousAvatarSwapTime: 1000
            }
        });

        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_old',
                    $previousAvatarSwapTime: 1000
                },
                nextSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_new'
                },
                isGameRunning: true,
                now: 2000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_new',
                $previousAvatarSwapTime: 2000
            }
        });
    });

    it('normalizes invalid timestamps through snapshot update paths', () => {
        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_same',
                    $previousAvatarSwapTime: -1
                },
                nextSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_same',
                    $previousAvatarSwapTime: 'bad'
                },
                isGameRunning: true,
                now: 3000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_same',
                $previousAvatarSwapTime: 3000
            }
        });
    });

    it('clears the swap time when the snapshot switches to another user without an avatar', () => {
        expect(
            buildAvatarWearSnapshotUpdate({
                previousSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_old',
                    $previousAvatarSwapTime: 1000
                },
                nextSnapshot: {
                    id: 'usr_other',
                    currentAvatar: ''
                },
                isGameRunning: true,
                now: 3000
            })
        ).toEqual({
            snapshot: {
                id: 'usr_other',
                currentAvatar: '',
                $previousAvatarSwapTime: null
            }
        });
    });

    it('adds live wear time only for the current running avatar and clamps negative elapsed time', () => {
        useRuntimeStore.getState().setGameState({
            isGameRunning: true
        });
        useRuntimeStore.getState().setAuthBootstrap({
            currentUserSnapshot: {
                id: 'usr_me',
                currentAvatar: 'avtr_live',
                $previousAvatarSwapTime: 1000
            }
        });
        vi.spyOn(Date, 'now').mockReturnValue(3500);

        expect(getCurrentAvatarLiveWearTime(' avtr_live ', 250)).toBe(2750);
        expect(getCurrentAvatarLiveWearTime('avtr_other', 250)).toBe(250);

        vi.spyOn(Date, 'now').mockReturnValue(500);
        expect(getCurrentAvatarLiveWearTime('avtr_live', 250)).toBe(250);

        useRuntimeStore.getState().setGameState({
            isGameRunning: false
        });
        expect(getCurrentAvatarLiveWearTime('avtr_live', 250)).toBe(250);
    });
});
