import { create } from 'zustand';

import {
    normalizeGlobalBadgeCatalog,
    type GlobalBadgeCatalog
} from '@/domain/badges/globalBadges';
import { commands } from '@/platform/tauri/bindings';

// The list only changes when the app downloads a newer signed copy, which it
// checks every few hours; re-reading it every half hour is plenty.
const REFRESH_MS = 30 * 60 * 1000;

function epochSeconds() {
    return Math.floor(Date.now() / 1000);
}

type GlobalBadgeStoreState = {
    catalog: GlobalBadgeCatalog | null;
    // When awards were last checked against their dates; moves on with each
    // refresh so an award that starts or ends shows up within one interval.
    nowSeconds: number;
};

export const useGlobalBadgeStore = create<GlobalBadgeStoreState>(() => ({
    catalog: null,
    nowSeconds: epochSeconds()
}));

let started = false;

async function readCatalog() {
    try {
        const catalog = normalizeGlobalBadgeCatalog(
            await commands.appGlobalBadgesGet()
        );
        if (!catalog) {
            return;
        }
        const current = useGlobalBadgeStore.getState().catalog;
        if (
            !current ||
            current.revision !== catalog.revision ||
            current.source !== catalog.source
        ) {
            useGlobalBadgeStore.setState({ catalog });
        }
        useGlobalBadgeStore.setState({ nowSeconds: epochSeconds() });
    } catch (error) {
        console.warn('Could not read the global badge list.', error);
    }
}

// The update check also downloads the badge list, so read it again right away.
export function refreshGlobalBadges() {
    return readCatalog();
}

export function ensureGlobalBadgesLoaded() {
    if (started) {
        return;
    }
    started = true;
    void readCatalog();
    setInterval(() => void readCatalog(), REFRESH_MS);
}
