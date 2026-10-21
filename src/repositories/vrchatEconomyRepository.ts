import { queryOptions } from '@tanstack/react-query';

import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys,
    setCachedQueryData
} from '@/lib/entityQueryCache';
import { commands } from '@/platform/tauri/bindings';
import type { AvatarProfileRecord } from '@/repositories/avatarProfileRepository';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import { isRecord } from '@/shared/utils/record';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import { unwrapVrchatResponse } from './vrchatRequest';

export type EconomyPurchaseRecord = Record<string, unknown> & {
    purchaseId?: string;
    buyerId?: string;
    listingId?: string;
    listingDisplayName?: string;
    listingSubtitle?: string;
    listingImageId?: string;
    listingType?: string;
    sellerDisplayName?: string;
    purchasePrice?: number;
    purchaseDate?: string;
    purchaseEndDate?: string;
    purchaseActive?: boolean;
    isGift?: boolean;
    products?: Array<{ id?: string }>;
};

export type EconomyTransactionRecord = Record<string, unknown> & {
    transactionLineId?: string;
    listingDisplayName?: string;
    listingType?: string;
    reasonLabel?: string;
    fromUserId?: string;
    fromUserDisplayName?: string;
    toUserId?: string;
    toUserDisplayName?: string;
    date?: string;
    platform?: string;
    amount?: number;
    balance?: number;
};

export type EconomyListingRecord = Record<string, unknown> & {
    id?: string;
    listingId?: string;
    displayName?: string;
    description?: string;
    imageId?: string;
    imageUrl?: string;
    priceTokens?: number;
    vrcPlusDiscountPrice?: number | null;
    listingType?: string;
    duration?: number;
    durationType?: string;
    productIds?: string[];
};

const PURCHASE_PAGE_SIZE = 50;
const LICENSED_PAGE_SIZE = 100;
const TRANSACTION_LIMIT = 100;
const MAX_PAGES = 40;

function records<T extends Record<string, unknown>>(value: unknown): T[] {
    return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

async function collectPages<T>(
    pageSize: number,
    fetchPage: (offset: number) => Promise<T[]>
) {
    const rows: T[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const pageRows = await fetchPage(page * pageSize);
        rows.push(...pageRows);
        if (pageRows.length < pageSize) {
            break;
        }
    }
    return rows;
}

async function getPurchases({
    userId,
    force = false
}: {
    userId: string;
    force?: boolean;
}): Promise<EconomyPurchaseRecord[]> {
    return fetchCachedData({
        queryKey: queryKeys.economyPurchases(
            userId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.economy,
        force,
        queryFn: () =>
            collectPages(PURCHASE_PAGE_SIZE, async (offset) =>
                records<EconomyPurchaseRecord>(
                    unwrapVrchatResponse<unknown>(
                        await commands.appVrchatEconomyPurchasesGet({
                            buyerId: userId,
                            n: PURCHASE_PAGE_SIZE,
                            offset
                        }),
                        'economy/purchases'
                    ).json
                )
            )
    });
}

async function getLicensedAvatars({
    userId,
    force = false
}: {
    userId: string;
    force?: boolean;
}): Promise<AvatarProfileRecord[]> {
    const rows = await fetchCachedData({
        queryKey: queryKeys.licensedAvatars(
            userId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.economy,
        force,
        queryFn: () =>
            collectPages(LICENSED_PAGE_SIZE, async (offset) =>
                records<Record<string, unknown>>(
                    unwrapVrchatResponse<unknown>(
                        await commands.appVrchatEconomyLicensedAvatarsGet({
                            n: LICENSED_PAGE_SIZE,
                            offset
                        }),
                        'avatars/licensed'
                    ).json
                )
            )
    });
    return rows.map((row) => avatarProfileRepository.normalize(row));
}

async function getTransactions({
    userId,
    force = false
}: {
    userId: string;
    force?: boolean;
}): Promise<EconomyTransactionRecord[]> {
    return fetchCachedData({
        queryKey: queryKeys.economyTransactions(
            userId,
            DEFAULT_VRCHAT_API_ENDPOINT
        ),
        policy: entityQueryPolicies.economy,
        force,
        queryFn: async () => {
            const json = unwrapVrchatResponse<unknown>(
                await commands.appVrchatEconomyTransactionsGet({
                    userId,
                    n: TRANSACTION_LIMIT
                }),
                `user/${encodeURIComponent(userId)}/economy/transactions`
            ).json;
            return records<EconomyTransactionRecord>(
                isRecord(json) ? json.transactions : json
            );
        }
    });
}

export function economyBalanceQueryOptions(userId: string) {
    return queryOptions({
        queryKey: queryKeys.economyBalance(userId, DEFAULT_VRCHAT_API_ENDPOINT),
        queryFn: async (): Promise<number | null> => {
            const json = unwrapVrchatResponse<unknown>(
                await commands.appVrchatEconomyBalanceGet({ userId }),
                `user/${encodeURIComponent(userId)}/economy/balance`
            ).json;
            const balance = isRecord(json) ? Number(json.balance) : NaN;
            return Number.isFinite(balance) ? balance : null;
        },
        ...entityQueryPolicies.economyBalance
    });
}

function setBalance(userId: string, balance: number) {
    setCachedQueryData(
        queryKeys.economyBalance(userId, DEFAULT_VRCHAT_API_ENDPOINT),
        balance
    );
}

async function getStoreListings({
    storeId,
    force = false
}: {
    storeId: string;
    force?: boolean;
}): Promise<EconomyListingRecord[]> {
    return fetchCachedData({
        queryKey: queryKeys.economyStore(storeId, DEFAULT_VRCHAT_API_ENDPOINT),
        policy: entityQueryPolicies.economy,
        force,
        queryFn: async () => {
            const json = unwrapVrchatResponse<unknown>(
                await commands.appVrchatEconomyStoreGet({ storeId }),
                'economy/store'
            ).json;
            return records<EconomyListingRecord>(
                isRecord(json) ? json.listings : []
            );
        }
    });
}

export function ownedFromPurchases(
    purchases: EconomyPurchaseRecord[],
    currentUserId: string
) {
    const listingIds = new Set<string>();
    const productIds = new Set<string>();
    for (const purchase of purchases) {
        if (
            purchase.purchaseActive !== true ||
            purchase.buyerId !== currentUserId
        ) {
            continue;
        }
        if (purchase.listingId) {
            listingIds.add(purchase.listingId);
        }
        for (const product of purchase.products ?? []) {
            if (product.id) {
                productIds.add(product.id);
            }
        }
    }
    return { listingIds, productIds };
}

const vrchatEconomyRepository = Object.freeze({
    getPurchases,
    getLicensedAvatars,
    getTransactions,
    setBalance,
    getStoreListings
});

export default vrchatEconomyRepository;
