import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

import { getCurrentAvatarLiveWearTime } from './avatarWearTimeService';

describe('avatarWearTimeService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
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
