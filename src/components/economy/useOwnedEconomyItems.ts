import { useEffect, useState } from 'react';

import vrchatEconomyRepository, {
    ownedFromPurchases
} from '@/repositories/vrchatEconomyRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

type OwnedEconomyItems = {
    listingIds: ReadonlySet<string>;
    productIds: ReadonlySet<string>;
};

const NOTHING_OWNED: OwnedEconomyItems = {
    listingIds: new Set(),
    productIds: new Set()
};

export function useOwnedEconomyItems(enabled: boolean) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [owned, setOwned] = useState<OwnedEconomyItems>(NOTHING_OWNED);

    useEffect(() => {
        if (!enabled || !currentUserId) {
            setOwned(NOTHING_OWNED);
            return undefined;
        }
        let active = true;
        vrchatEconomyRepository
            .getPurchases({ userId: currentUserId })
            .then((purchases) => {
                if (active) {
                    setOwned(ownedFromPurchases(purchases, currentUserId));
                }
            })
            .catch(() => {
                if (active) {
                    setOwned(NOTHING_OWNED);
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, enabled]);

    return owned;
}
