import configRepository from '@/repositories/configRepository';
import vrchatEconomyRepository, {
    ownedFromPurchases,
    type EconomyListingRecord
} from '@/repositories/vrchatEconomyRepository';
import { HOUR_MS, SECOND_MS } from '@/shared/constants/time';
import { replaceBioSymbols } from '@/shared/utils/string';
import { useFreeStoreItemStore } from '@/state/freeStoreItemStore';
import { useRuntimeStore } from '@/state/runtimeStore';

// The VRChat stores VRCX checks for free items.
export const VRCHAT_STORE_IDS = [
    'esto_00000000-0000-0000-0000-000000000000',
    'esto_00000000-0000-0000-0000-000000000001',
    'esto_00000000-0000-0000-0000-000000000002'
];
const FIRST_CHECK_DELAY_MS = 60 * SECOND_MS;
const CHECK_INTERVAL_MS = 3 * HOUR_MS;
// Listings VRChat refused to give away, per account; never offered again.
const FAILED_LISTINGS_CONFIG_KEY = 'freeStoreItemFailedListingIds';

type Owned = { listingIds: Set<string>; productIds: Set<string> };

function effectivePrice(listing: EconomyListingRecord, isVrcPlus: boolean) {
    if (
        isVrcPlus &&
        listing.vrcPlusDiscountPrice !== null &&
        listing.vrcPlusDiscountPrice !== undefined
    ) {
        return Number(listing.vrcPlusDiscountPrice) || 0;
    }
    return Number(listing.priceTokens) || 0;
}

function isOwned(listing: EconomyListingRecord, owned: Owned) {
    if (listing.id && owned.listingIds.has(listing.id)) {
        return true;
    }
    const productIds = listing.productIds ?? [];
    return (
        productIds.length > 0 &&
        productIds.every((id) => owned.productIds.has(id))
    );
}

// A free single item that is also part of a free bundle is offered once, as
// the bundle.
function isInLargerListing(
    listing: EconomyListingRecord,
    listings: EconomyListingRecord[]
) {
    const productIds = listing.productIds ?? [];
    if (productIds.length === 0) {
        return false;
    }
    return listings.some((other) => {
        const otherIds = other.productIds ?? [];
        return (
            other.id !== listing.id &&
            otherIds.length > productIds.length &&
            productIds.every((id) => otherIds.includes(id))
        );
    });
}

export function findFreeListings(
    listings: EconomyListingRecord[],
    {
        owned,
        isVrcPlus,
        excludedIds
    }: { owned: Owned; isVrcPlus: boolean; excludedIds: Set<string> }
): EconomyListingRecord[] {
    const free = new Map<string, EconomyListingRecord>();
    for (const listing of listings) {
        if (
            listing.id &&
            listing.active === true &&
            effectivePrice(listing, isVrcPlus) === 0 &&
            !isOwned(listing, owned) &&
            !excludedIds.has(listing.id)
        ) {
            free.set(listing.id, listing);
        }
    }
    const candidates = [...free.values()];
    return candidates.filter(
        (listing) => !isInLargerListing(listing, candidates)
    );
}

async function readFailedListingIds(userId: string): Promise<Set<string>> {
    const byUser = await configRepository.getObject<Record<string, unknown>>(
        FAILED_LISTINGS_CONFIG_KEY,
        {}
    );
    const ids = byUser?.[userId];
    return new Set(
        Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === 'string')
            : []
    );
}

export async function rememberFailedFreeListings(
    userId: string,
    listingIds: string[]
) {
    if (!userId || listingIds.length === 0) {
        return;
    }
    const byUser =
        (await configRepository.getObject<Record<string, unknown>>(
            FAILED_LISTINGS_CONFIG_KEY,
            {}
        )) ?? {};
    const ids = await readFailedListingIds(userId);
    for (const id of listingIds) {
        ids.add(id);
    }
    await configRepository.setObject(FAILED_LISTINGS_CONFIG_KEY, {
        ...byUser,
        [userId]: [...ids]
    });
}

function isVrcPlusSupporter() {
    const snapshot = useRuntimeStore.getState().auth.currentUserSnapshot;
    return Boolean(
        snapshot?.$isVRCPlus || snapshot?.tags?.includes?.('system_supporter')
    );
}

export async function checkFreeStoreItems(
    userId: string,
    shownIds: Set<string>
) {
    const [shelves, purchases, failedIds] = await Promise.all([
        Promise.all(
            VRCHAT_STORE_IDS.map((storeId) =>
                vrchatEconomyRepository.getStoreShelfListings(storeId)
            )
        ),
        vrchatEconomyRepository.getPurchases({ userId, force: true }),
        readFailedListingIds(userId)
    ]);
    const listings = findFreeListings(shelves.flat(), {
        owned: ownedFromPurchases(purchases, userId),
        isVrcPlus: isVrcPlusSupporter(),
        excludedIds: new Set([...failedIds, ...shownIds])
    });
    for (const listing of listings) {
        if (listing.id) {
            shownIds.add(listing.id);
        }
    }
    if (listings.length > 0) {
        // VRChat writes some characters in names as look-alike symbols.
        useFreeStoreItemStore.getState().show(
            listings.map((listing) => ({
                ...listing,
                displayName:
                    typeof listing.displayName === 'string'
                        ? replaceBioSymbols(listing.displayName)
                        : listing.displayName
            }))
        );
    }
}

// Off unless the user turned on free store item notifications; reads the
// store and the user's purchases only.
export function startFreeStoreItemWatch(userId: string) {
    const shownIds = new Set<string>();
    const check = () => {
        checkFreeStoreItems(userId, shownIds).catch((error: unknown) => {
            console.warn('Failed to check free store items:', error);
        });
    };
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
        check();
        interval = setInterval(check, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);
    return () => {
        clearTimeout(timeout);
        if (interval) {
            clearInterval(interval);
        }
        useFreeStoreItemStore.getState().close();
    };
}
