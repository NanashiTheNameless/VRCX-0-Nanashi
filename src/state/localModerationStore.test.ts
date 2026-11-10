import { afterEach, describe, expect, it, vi } from 'vitest';

import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';

import {
    trackLocalModerations,
    useLocalModerationStore
} from './localModerationStore';

vi.mock('@/repositories/vrchatModerationRepository', () => ({
    default: { getAllLocalModerations: vi.fn() }
}));

const listeners = new Set<(change: { ownerUserId: string }) => void>();
vi.mock('@/services/moderationSyncService', () => ({
    subscribeModerationSyncChanges: (
        listener: (change: { ownerUserId: string }) => void
    ) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
}));

const list = vi.mocked(vrchatModerationRepository.getAllLocalModerations);

function row(userId: string, block: boolean, mute: boolean) {
    return { userId, updatedAt: 0, displayName: '', block, mute };
}

afterEach(() => {
    trackLocalModerations(null);
    vi.clearAllMocks();
});

describe('local moderation store', () => {
    it('keeps blocked and muted users of the tracked account', async () => {
        list.mockResolvedValue([
            row('usr_a', true, false),
            row('usr_b', false, true),
            row('usr_c', false, false)
        ]);
        trackLocalModerations('usr_self');
        await vi.waitFor(() =>
            expect(useLocalModerationStore.getState().loaded).toBe(true)
        );
        const { byUserId } = useLocalModerationStore.getState();
        expect(list).toHaveBeenCalledWith('usr_self');
        expect(byUserId.get('usr_a')).toEqual({ block: true, mute: false });
        expect(byUserId.get('usr_b')).toEqual({ block: false, mute: true });
        expect(byUserId.has('usr_c')).toBe(false);
    });

    it('reads again after a moderation change and clears on sign-out', async () => {
        list.mockResolvedValue([]);
        trackLocalModerations('usr_self');
        await vi.waitFor(() =>
            expect(useLocalModerationStore.getState().loaded).toBe(true)
        );
        trackLocalModerations('usr_self');
        expect(list).toHaveBeenCalledTimes(1);

        list.mockResolvedValue([row('usr_a', true, false)]);
        listeners.forEach((listener) => listener({ ownerUserId: 'usr_self' }));
        await vi.waitFor(() =>
            expect(
                useLocalModerationStore.getState().byUserId.has('usr_a')
            ).toBe(true)
        );

        trackLocalModerations(null);
        expect(listeners.size).toBe(0);
        expect(useLocalModerationStore.getState()).toMatchObject({
            ownerUserId: '',
            loaded: false
        });
        expect(useLocalModerationStore.getState().byUserId.size).toBe(0);
    });
});
