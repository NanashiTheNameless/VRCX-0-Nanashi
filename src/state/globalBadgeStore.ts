import { create } from 'zustand';

import {
    normalizeGlobalBadgeCatalog,
    type GlobalBadgeCatalog
} from '@/domain/badges/globalBadges';
import { commands } from '@/platform/tauri/bindings';

// Reading the list is a local call (no network), so check often: a newer
// copy adopted at startup or by the 6-hourly download shows within a minute.
const REFRESH_MS = 60 * 1000;
// Awards start and end on dates; re-checking them every half hour is plenty,
// and moving the clock less often avoids redrawing every badge each minute.
const CLOCK_MS = 30 * 60 * 1000;

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
        const changed =
            !current ||
            current.revision !== catalog.revision ||
            current.source !== catalog.source;
        const now = epochSeconds();
        const clockDue =
            now - useGlobalBadgeStore.getState().nowSeconds >= CLOCK_MS / 1000;
        if (changed || clockDue) {
            useGlobalBadgeStore.setState({
                ...(changed ? { catalog } : {}),
                nowSeconds: now
            });
        }
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

const iconSets = new WeakMap<GlobalBadgeCatalog, ReadonlySet<string>>();
const NO_ICONS: ReadonlySet<string> = new Set();

// Every icon the current global badge list uses, badge types and per-person
// overrides alike. Custom badges may not use these (see isReservedBadgeIcon).
export function globalBadgeIcons(
    catalog: GlobalBadgeCatalog | null
): ReadonlySet<string> {
    if (!catalog) {
        return NO_ICONS;
    }
    let icons = iconSets.get(catalog);
    if (!icons) {
        icons = new Set(
            [
                ...catalog.badges.map((badge) => badge.icon),
                ...catalog.awards.map((grant) => grant.overrides.icon)
            ].filter(Boolean)
        );
        iconSets.set(catalog, icons);
    }
    return icons;
}

export function useGlobalBadgeIcons(): ReadonlySet<string> {
    return useGlobalBadgeStore((state) => globalBadgeIcons(state.catalog));
}
