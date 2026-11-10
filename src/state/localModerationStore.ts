import { create } from 'zustand';

import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';
import { subscribeModerationSyncChanges } from '@/services/moderationSyncService';

// Who the signed-in account has blocked or muted, read from the local
// moderation table that the background moderation refresh keeps current.
// Reading it is a local call; nothing here contacts VRChat.

export type LocalModerationEntry = { block: boolean; mute: boolean };

type LocalModerationStoreState = {
    ownerUserId: string;
    loaded: boolean;
    byUserId: ReadonlyMap<string, LocalModerationEntry>;
};

// The background refresh writes the table without telling the window, so
// read it again now and then while something needs it.
const RELOAD_INTERVAL_MS = 5 * 60 * 1000;

export const useLocalModerationStore = create<LocalModerationStoreState>(
    () => ({ ownerUserId: '', loaded: false, byUserId: new Map() })
);

let trackedOwner = '';
let requestId = 0;
let stopTracking: (() => void) | null = null;

function load(ownerUserId: string) {
    const current = ++requestId;
    vrchatModerationRepository
        .getAllLocalModerations(ownerUserId)
        .then((rows) => {
            if (current !== requestId) {
                return;
            }
            const byUserId = new Map<string, LocalModerationEntry>();
            for (const row of rows) {
                if (row.userId && (row.block || row.mute)) {
                    byUserId.set(row.userId, {
                        block: row.block,
                        mute: row.mute
                    });
                }
            }
            useLocalModerationStore.setState({
                ownerUserId,
                loaded: true,
                byUserId
            });
        })
        .catch((error: unknown) => {
            if (current === requestId) {
                console.warn('Failed to read local moderations.', error);
            }
        });
}

/** Keeps the store on the given account's moderations; null stops it. */
export function trackLocalModerations(ownerUserId: string | null) {
    const owner = ownerUserId ?? '';
    if (owner === trackedOwner) {
        return;
    }
    stopTracking?.();
    stopTracking = null;
    trackedOwner = owner;
    requestId++;
    useLocalModerationStore.setState({
        ownerUserId: owner,
        loaded: false,
        byUserId: new Map()
    });
    if (!owner) {
        return;
    }
    load(owner);
    const unsubscribe = subscribeModerationSyncChanges((change) => {
        if (!change.ownerUserId || change.ownerUserId === owner) {
            load(owner);
        }
    });
    const timer = setInterval(() => load(owner), RELOAD_INTERVAL_MS);
    stopTracking = () => {
        unsubscribe();
        clearInterval(timer);
    };
}
