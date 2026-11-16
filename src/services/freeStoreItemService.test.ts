import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    shelves: vi.fn(),
    purchases: vi.fn(),
    notify: vi.fn().mockResolvedValue(null)
}));

vi.mock('@/repositories/vrchatEconomyRepository', async (importOriginal) => {
    const actual =
        await importOriginal<
            typeof import('@/repositories/vrchatEconomyRepository')
        >();
    return {
        ...actual,
        default: {
            ...actual.default,
            getStoreShelfListings: mocks.shelves,
            getPurchases: mocks.purchases
        }
    };
});

vi.mock('@/platform/tauri/bindings', () => ({
    commands: { appFreeStoreItemsNotify: mocks.notify }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getObject: vi.fn().mockResolvedValue({}),
        setObject: vi.fn().mockResolvedValue(null)
    }
}));

import { useFreeStoreItemStore } from '@/state/freeStoreItemStore';

import {
    checkFreeStoreItems,
    checkFreeStoreItemsNow,
    findFreeListings
} from './freeStoreItemService';

const none = {
    owned: { listingIds: new Set<string>(), productIds: new Set<string>() },
    isVrcPlus: false,
    excludedIds: new Set<string>()
};

describe('findFreeListings', () => {
    it('offers active free listings only', () => {
        const ids = findFreeListings(
            [
                { id: 'free', active: true, priceTokens: 0 },
                { id: 'paid', active: true, priceTokens: 100 },
                { id: 'inactive', active: false, priceTokens: 0 }
            ],
            none
        ).map((listing) => listing.id);
        expect(ids).toEqual(['free']);
    });

    it('uses the VRC+ price only for supporters', () => {
        const listing = {
            id: 'plus',
            active: true,
            priceTokens: 100,
            vrcPlusDiscountPrice: 0
        };
        expect(findFreeListings([listing], none)).toEqual([]);
        expect(
            findFreeListings([listing], { ...none, isVrcPlus: true })
        ).toEqual([listing]);
    });

    it('skips owned, shown and refused listings', () => {
        const listings = [
            { id: 'owned-listing', active: true, priceTokens: 0 },
            {
                id: 'owned-products',
                active: true,
                priceTokens: 0,
                productIds: ['prod_a']
            },
            { id: 'refused', active: true, priceTokens: 0 },
            { id: 'new', active: true, priceTokens: 0 }
        ];
        const ids = findFreeListings(listings, {
            owned: {
                listingIds: new Set(['owned-listing']),
                productIds: new Set(['prod_a'])
            },
            isVrcPlus: false,
            excludedIds: new Set(['refused'])
        }).map((listing) => listing.id);
        expect(ids).toEqual(['new']);
    });

    it('offers a free bundle instead of the items inside it', () => {
        const ids = findFreeListings(
            [
                {
                    id: 'single',
                    active: true,
                    priceTokens: 0,
                    productIds: ['prod_a']
                },
                {
                    id: 'bundle',
                    active: true,
                    priceTokens: 0,
                    productIds: ['prod_a', 'prod_b']
                }
            ],
            none
        ).map((listing) => listing.id);
        expect(ids).toEqual(['bundle']);
    });
});

describe('checkFreeStoreItemsNow', () => {
    beforeEach(() => {
        mocks.shelves.mockReset();
        mocks.purchases.mockReset();
        mocks.purchases.mockResolvedValue([]);
        mocks.notify.mockClear();
        useFreeStoreItemStore.setState({ open: false, listings: [] });
    });

    it('offers items the automatic check already offered', async () => {
        mocks.shelves.mockImplementation(async (storeId: string) =>
            storeId.endsWith('0')
                ? [{ id: 'free', active: true, priceTokens: 0 }]
                : []
        );
        const shown = new Set<string>();
        expect(await checkFreeStoreItems('usr_now', shown)).toBe(1);
        useFreeStoreItemStore.getState().close();
        expect(await checkFreeStoreItems('usr_now', shown)).toBe(0);

        expect(await checkFreeStoreItemsNow('usr_now')).toBe(1);
        expect(useFreeStoreItemStore.getState().listings).toHaveLength(1);
        // Only the automatic check notifies; Check now just opens the window.
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('sends what the automatic check found to the notification channels', async () => {
        mocks.notify.mockClear();
        mocks.shelves.mockImplementation(async (storeId: string) =>
            storeId.endsWith('0')
                ? [
                      {
                          id: 'free',
                          displayName: 'Free Hat',
                          active: true,
                          priceTokens: 0
                      }
                  ]
                : []
        );
        await checkFreeStoreItems('usr_notify', new Set(), { notify: true });
        expect(mocks.notify).toHaveBeenCalledWith(['Free Hat']);
    });

    it('skips items already in the open window', async () => {
        mocks.shelves.mockImplementation(async (storeId: string) =>
            storeId.endsWith('0')
                ? [
                      { id: 'a', active: true, priceTokens: 0 },
                      { id: 'b', active: true, priceTokens: 0 }
                  ]
                : []
        );
        useFreeStoreItemStore.getState().show([{ id: 'a' }]);
        expect(await checkFreeStoreItemsNow('usr_open')).toBe(1);
        expect(
            useFreeStoreItemStore.getState().listings.map((item) => item.id)
        ).toEqual(['a', 'b']);
    });
});
