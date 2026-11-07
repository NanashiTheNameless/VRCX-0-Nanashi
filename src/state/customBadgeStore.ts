import { create } from 'zustand';

import {
    CUSTOM_BADGES_CONFIG_KEY,
    normalizeCustomBadges,
    type CustomBadge
} from '@/domain/badges/customBadges';
import configRepository from '@/repositories/configRepository';

type CustomBadgeStoreState = {
    badges: CustomBadge[];
    loaded: boolean;
    loadFailed: boolean;
    load: () => Promise<void>;
    reload: () => Promise<void>;
    update: (
        change: (current: CustomBadge[]) => CustomBadge[]
    ) => Promise<CustomBadge[]>;
};

let loadPromise: Promise<void> | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();

export const useCustomBadgeStore = create<CustomBadgeStoreState>(
    (set, get) => ({
        badges: [],
        loaded: false,
        loadFailed: false,
        load() {
            loadPromise ??= configRepository
                .getString(CUSTOM_BADGES_CONFIG_KEY, '[]')
                .then((raw) => {
                    set({
                        badges: normalizeCustomBadges(raw),
                        loaded: true,
                        loadFailed: false
                    });
                })
                .catch((error: unknown) => {
                    loadPromise = null;
                    console.warn('Failed to load custom badges.', error);
                    set({ loaded: true, loadFailed: true });
                });
            return loadPromise;
        },
        // Settings Sync can replace the stored value; read it again.
        reload() {
            loadPromise = null;
            return get().load();
        },
        // Changes run one at a time against the latest list, so quick edits
        // never overwrite each other.
        update(change) {
            const run = saveQueue.then(async () => {
                if (!get().loaded) {
                    await get().load();
                } else if (get().loadFailed) {
                    await get().reload();
                }
                if (get().loadFailed) {
                    // Saving now would replace badges that could not be read.
                    throw new Error('Custom badges could not be loaded.');
                }
                const badges = normalizeCustomBadges(change(get().badges));
                await configRepository.setString(
                    CUSTOM_BADGES_CONFIG_KEY,
                    JSON.stringify(badges)
                );
                set({ badges });
                return badges;
            });
            saveQueue = run.catch(() => undefined);
            return run;
        }
    })
);

export function ensureCustomBadgesLoaded() {
    const state = useCustomBadgeStore.getState();
    if (!state.loaded) {
        void state.load();
    }
}
