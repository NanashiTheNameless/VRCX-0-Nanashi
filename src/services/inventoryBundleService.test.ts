import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getInventoryItems } = vi.hoisted(() => ({
    getInventoryItems: vi.fn()
}));

vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: { getInventoryItems }
}));

import {
    hasUnseenInventoryBundles,
    useInventoryBundleStore
} from '@/state/inventoryBundleStore';

import { refreshInventoryBundles } from './inventoryBundleService';

function bundles(...items: Array<{ id: string; templateId?: string }>) {
    return { json: { data: items, totalCount: items.length } };
}

describe('inventoryBundleService', () => {
    beforeEach(() => {
        getInventoryItems.mockReset();
        useInventoryBundleStore.getState().reset();
    });

    it('counts unopened bundles except the unredeemable template', async () => {
        getInventoryItems.mockResolvedValue(
            bundles(
                { id: 'inv_a', templateId: 'invt_real' },
                {
                    id: 'inv_broken',
                    templateId: 'invt_08e50f24-8807-4ec2-a0f9-9e008371280b'
                }
            )
        );

        await refreshInventoryBundles('usr_self');

        expect(getInventoryItems).toHaveBeenCalledWith(
            expect.objectContaining({ types: 'bundle', n: 100 })
        );
        expect(useInventoryBundleStore.getState().bundleIds).toEqual(['inv_a']);
    });

    it('keeps seen bundles quiet until a new bundle arrives', async () => {
        getInventoryItems.mockResolvedValue(bundles({ id: 'inv_a' }));
        await refreshInventoryBundles('usr_self');
        expect(
            hasUnseenInventoryBundles(useInventoryBundleStore.getState())
        ).toBe(true);

        useInventoryBundleStore.getState().markSeen();
        await refreshInventoryBundles('usr_self');
        expect(
            hasUnseenInventoryBundles(useInventoryBundleStore.getState())
        ).toBe(false);

        getInventoryItems.mockResolvedValue(
            bundles({ id: 'inv_a' }, { id: 'inv_b' })
        );
        await refreshInventoryBundles('usr_self');
        expect(
            hasUnseenInventoryBundles(useInventoryBundleStore.getState())
        ).toBe(true);
    });
});
