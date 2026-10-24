import { create } from 'zustand';

import { instanceLocationKey } from '@/domain/presence/instancePresence';
import { parseAbsoluteDateMs } from '@/shared/utils/displayTimeZone';

interface InstanceJoinHistoryStoreState {
    joinedAtByLocation: Record<string, number>;
    lastJoinedAtByLocation: Record<string, number>;
    setInstanceJoinHistory: (
        entries: Iterable<[string, string | number]>
    ) => void;
    recordInstanceJoin: (location: string, joinedAt: string | number) => void;
    resetInstanceJoinHistory: () => void;
}

const initialState: Pick<
    InstanceJoinHistoryStoreState,
    'joinedAtByLocation' | 'lastJoinedAtByLocation'
> = {
    joinedAtByLocation: {},
    lastJoinedAtByLocation: {}
};

function epochMs(value: string | number): number {
    const parsed = parseAbsoluteDateMs(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const useInstanceJoinHistoryStore =
    create<InstanceJoinHistoryStoreState>((set) => ({
        ...initialState,
        setInstanceJoinHistory(entries) {
            const joinedAtByLocation: Record<string, number> = {};
            for (const [location, joinedAt] of entries) {
                const key = instanceLocationKey(location);
                const epoch =
                    typeof joinedAt === 'number' ? joinedAt : epochMs(joinedAt);
                if (!key || !epoch) {
                    continue;
                }
                const existing = joinedAtByLocation[key];
                joinedAtByLocation[key] = existing
                    ? Math.min(existing, epoch)
                    : epoch;
            }
            set({ joinedAtByLocation });
        },
        recordInstanceJoin(location, joinedAt) {
            set((state) => {
                const key = instanceLocationKey(location);
                const epoch = epochMs(joinedAt);
                if (!key || !epoch) {
                    return state;
                }
                const existing = state.joinedAtByLocation[key];
                const lastJoinedAt = state.lastJoinedAtByLocation[key];
                const keepsFirst = Boolean(existing && existing <= epoch);
                const keepsLast = Boolean(
                    lastJoinedAt && lastJoinedAt >= epoch
                );
                if (keepsFirst && keepsLast) {
                    return state;
                }
                return {
                    joinedAtByLocation: keepsFirst
                        ? state.joinedAtByLocation
                        : { ...state.joinedAtByLocation, [key]: epoch },
                    lastJoinedAtByLocation: keepsLast
                        ? state.lastJoinedAtByLocation
                        : { ...state.lastJoinedAtByLocation, [key]: epoch }
                };
            });
        },
        resetInstanceJoinHistory() {
            set(initialState);
        }
    }));

export type { InstanceJoinHistoryStoreState };
