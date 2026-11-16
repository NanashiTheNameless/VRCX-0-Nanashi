import { create } from 'zustand';

import type { EconomyListingRecord } from '@/repositories/vrchatEconomyRepository';

interface FreeStoreItemStoreState {
    open: boolean;
    listings: EconomyListingRecord[];
    show(listings: EconomyListingRecord[]): void;
    close(): void;
}

export const useFreeStoreItemStore = create<FreeStoreItemStoreState>((set) => ({
    open: false,
    listings: [],
    show(listings) {
        set((state) => ({
            open: true,
            listings: state.open ? [...state.listings, ...listings] : listings
        }));
    },
    close() {
        set({ open: false, listings: [] });
    }
}));
