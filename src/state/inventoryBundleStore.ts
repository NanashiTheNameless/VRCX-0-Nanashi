import { create } from 'zustand';

interface InventoryBundleStoreState {
    ownerUserId: string;
    bundleIds: string[];
    seenBundleIds: string[];
    setBundles(ownerUserId: string, bundleIds: string[]): void;
    markSeen(): void;
    reset(): void;
}

const initialState = {
    ownerUserId: '',
    bundleIds: [],
    seenBundleIds: []
};

export const useInventoryBundleStore = create<InventoryBundleStoreState>(
    (set) => ({
        ...initialState,
        setBundles(ownerUserId, bundleIds) {
            set((state) => ({
                ownerUserId,
                bundleIds,
                seenBundleIds:
                    state.ownerUserId === ownerUserId
                        ? state.seenBundleIds.filter((id) =>
                              bundleIds.includes(id)
                          )
                        : []
            }));
        },
        markSeen() {
            set((state) => ({ seenBundleIds: [...state.bundleIds] }));
        },
        reset() {
            set({ ...initialState });
        }
    })
);

export function hasUnseenInventoryBundles(state: InventoryBundleStoreState) {
    return state.bundleIds.some((id) => !state.seenBundleIds.includes(id));
}
