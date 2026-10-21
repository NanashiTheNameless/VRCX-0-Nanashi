import { describe, expect, it } from 'vitest';

import { ownedFromPurchases } from './vrchatEconomyRepository';

describe('ownedFromPurchases', () => {
    it('counts only active purchases made by the current user', () => {
        const owned = ownedFromPurchases(
            [
                {
                    buyerId: 'usr_self',
                    purchaseActive: true,
                    listingId: 'prod_active',
                    products: [{ id: 'prod_avatar' }]
                },
                {
                    buyerId: 'usr_self',
                    purchaseActive: false,
                    listingId: 'prod_expired',
                    products: [{ id: 'prod_expired_avatar' }]
                },
                {
                    buyerId: 'usr_gifter',
                    purchaseActive: true,
                    listingId: 'prod_gifted_to_other'
                }
            ],
            'usr_self'
        );

        expect([...owned.listingIds]).toEqual(['prod_active']);
        expect([...owned.productIds]).toEqual(['prod_avatar']);
    });
});
