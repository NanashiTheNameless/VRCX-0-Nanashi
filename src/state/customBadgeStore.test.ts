import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn()
}));

vi.mock('@/repositories/configRepository', () => ({ default: config }));

import type { CustomBadge } from '@/domain/badges/customBadges';

import { useCustomBadgeStore } from './customBadgeStore';

function badge(id: string): CustomBadge {
    return {
        id,
        label: id,
        icon: 'Star',
        color: '#336699',
        enabled: true,
        rules: []
    };
}

describe('customBadgeStore', () => {
    beforeEach(async () => {
        config.getString.mockReset();
        config.setString.mockReset();
        config.setString.mockResolvedValue(null);
        config.getString.mockResolvedValue('[]');
        useCustomBadgeStore.setState({
            badges: [],
            loaded: false,
            loadFailed: false
        });
        await useCustomBadgeStore.getState().reload();
    });

    it('never saves over badges it could not read', async () => {
        config.getString.mockRejectedValue(new Error('disk'));
        await useCustomBadgeStore.getState().reload();
        expect(useCustomBadgeStore.getState().loadFailed).toBe(true);

        await expect(
            useCustomBadgeStore
                .getState()
                .update((current) => [...current, badge('a')])
        ).rejects.toThrow();
        expect(config.setString).not.toHaveBeenCalled();
    });

    it('retries the read before saving after an earlier failure', async () => {
        config.getString.mockRejectedValueOnce(new Error('disk'));
        await useCustomBadgeStore.getState().reload();
        config.getString.mockResolvedValue(JSON.stringify([badge('kept')]));

        const saved = await useCustomBadgeStore
            .getState()
            .update((current) => [...current, badge('new')]);
        expect(saved.map((entry) => entry.id)).toEqual(['kept', 'new']);
    });

    it('applies quick successive changes on top of each other', async () => {
        const store = useCustomBadgeStore.getState();
        await Promise.all([
            store.update((current) => [...current, badge('a')]),
            store.update((current) => [...current, badge('b')])
        ]);
        expect(
            useCustomBadgeStore.getState().badges.map((entry) => entry.id)
        ).toEqual(['a', 'b']);
    });

    it('reload picks up badges written by Settings Sync', async () => {
        config.getString.mockResolvedValue(JSON.stringify([badge('synced')]));
        await useCustomBadgeStore.getState().reload();
        expect(
            useCustomBadgeStore.getState().badges.map((entry) => entry.id)
        ).toEqual(['synced']);
    });
});
