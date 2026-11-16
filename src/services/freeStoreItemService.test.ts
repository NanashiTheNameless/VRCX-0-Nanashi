import { describe, expect, it } from 'vitest';

import { findFreeListings } from './freeStoreItemService';

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
