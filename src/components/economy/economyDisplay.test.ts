import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { listingPrice, listingTerm } from './economyDisplay';

const t = ((key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key) as TFunction;

describe('economyDisplay', () => {
    it('translates subscription durations by unit and keeps unknown units raw', () => {
        expect(
            listingTerm(
                {
                    listingType: 'subscription',
                    duration: 3,
                    durationType: 'months'
                },
                t
            )
        ).toBe(
            'economy.subscription_term:{"duration":"economy.duration.month:{\\"count\\":3}"}'
        );
        expect(listingTerm({ duration: 2, durationType: 'fortnight' }, t)).toBe(
            'economy.subscription_term:{"duration":"2 fortnight"}'
        );
        expect(listingTerm({ listingType: 'permanent' }, t)).toBe(
            'economy.permanent'
        );
    });

    it('shows the VRC+ price only when it differs from the regular price', () => {
        expect(listingPrice({ priceTokens: 0 }, t)).toEqual({
            label: 'economy.free',
            vrcPlusLabel: ''
        });
        expect(
            listingPrice({ priceTokens: 1000, vrcPlusDiscountPrice: 1000 }, t)
                .vrcPlusLabel
        ).toBe('');
        expect(
            listingPrice({ priceTokens: 1000, vrcPlusDiscountPrice: 800 }, t)
                .vrcPlusLabel
        ).toContain('economy.vrc_plus_price');
    });
});
