import type { TFunction } from 'i18next';

import type { EconomyListingRecord } from '@/repositories/vrchatEconomyRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

export function formatCredits(value: number) {
    return `${value.toLocaleString()}V`;
}

export function economyImageUrl(
    imageUrl: string | undefined,
    imageId: string | undefined,
    resolution = 256
) {
    if (imageUrl) {
        return convertFileUrlToImageUrl(imageUrl, resolution);
    }
    return imageId
        ? convertFileUrlToImageUrl(`file/${imageId}/1`, resolution)
        : '';
}

export function listingPrice(listing: EconomyListingRecord, t: TFunction) {
    const price = Number(listing.priceTokens) || 0;
    if (price <= 0) {
        return { label: t('economy.free'), vrcPlusLabel: '' };
    }
    const vrcPlusPrice = listing.vrcPlusDiscountPrice;
    return {
        label: formatCredits(price),
        vrcPlusLabel:
            typeof vrcPlusPrice === 'number' && vrcPlusPrice !== price
                ? t('economy.vrc_plus_price', {
                      price: formatCredits(vrcPlusPrice)
                  })
                : ''
    };
}

const DURATION_UNITS = new Set(['day', 'week', 'month', 'year']);

export function listingTerm(listing: EconomyListingRecord, t: TFunction) {
    if (listing.duration && listing.durationType) {
        const unit = listing.durationType.toLowerCase().replace(/s$/, '');
        return t('economy.subscription_term', {
            duration: DURATION_UNITS.has(unit)
                ? t(`economy.duration.${unit}`, { count: listing.duration })
                : `${listing.duration} ${listing.durationType}`
        });
    }
    return listing.listingType === 'permanent' || !listing.listingType
        ? t('economy.permanent')
        : listing.listingType;
}
