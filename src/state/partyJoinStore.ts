import { create } from 'zustand';

import type { PartyJoinOffer } from '@/domain/presence/followParty';

type PartyJoinStoreState = {
    offer: PartyJoinOffer | null;
    setOffer: (offer: PartyJoinOffer | null) => void;
};

/** A party link waiting for the user to confirm or dismiss it. */
export const usePartyJoinStore = create<PartyJoinStoreState>((set) => ({
    offer: null,
    setOffer(offer) {
        set({ offer });
    }
}));
