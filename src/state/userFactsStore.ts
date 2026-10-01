import { create } from 'zustand';

import { userFactKey, type UserFact } from '@/domain/users/userFacts';
import { evictOverflow } from '@/state/storeEviction';

type UserFactInput = Omit<Partial<UserFact>, 'endpoint' | 'id' | 'updatedAt'> &
    Record<string, unknown> & {
        endpoint?: string;
        id?: string;
        updatedAt?: string;
        userId?: string;
    };

interface UserFactsStoreState {
    usersByKey: Record<string, UserFact>;
    userIdsByEndpoint: Record<string, Set<string>>;
    order: string[];
    replaceUserFacts: (users: UserFactInput[] | null | undefined) => void;
    resetUserFacts: () => void;
}

const USER_FACTS_NON_FRIEND_CAPACITY = 1000;

const initialState: Pick<
    UserFactsStoreState,
    'usersByKey' | 'userIdsByEndpoint' | 'order'
> = {
    usersByKey: {},
    userIdsByEndpoint: {},
    order: []
};

function text(value: string | undefined): string {
    return value?.trim() ?? '';
}

function endpointFromKey(key: string): string {
    return key.split('::')[0] || 'default';
}

function isUserFactInput(value: unknown): value is UserFactInput {
    return Boolean(
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (!('endpoint' in value) ||
            value.endpoint === undefined ||
            typeof value.endpoint === 'string') &&
        (!('id' in value) ||
            value.id === undefined ||
            typeof value.id === 'string') &&
        (!('updatedAt' in value) ||
            value.updatedAt === undefined ||
            typeof value.updatedAt === 'string') &&
        (!('userId' in value) ||
            value.userId === undefined ||
            typeof value.userId === 'string')
    );
}

function isStoredUserFact(
    user: UserFactInput,
    key: string,
    userId: string
): user is UserFactInput & UserFact {
    return (
        typeof user.id === 'string' &&
        user.id.trim() === userId &&
        typeof user.endpoint === 'string' &&
        user.endpoint.trim() === endpointFromKey(key) &&
        typeof user.updatedAt === 'string'
    );
}

function toUserFact(user: UserFactInput, key: string): UserFact | null {
    const userId = text(user.id ?? user.userId);
    if (!userId) {
        return null;
    }
    if (isStoredUserFact(user, key, userId)) {
        return user;
    }
    const {
        endpoint: _endpoint,
        id: _id,
        updatedAt,
        userId: _userId,
        ...rest
    } = user;
    return {
        ...rest,
        id: userId,
        endpoint: endpointFromKey(key),
        updatedAt: text(updatedAt) || new Date().toISOString()
    };
}

export const useUserFactsStore = create<UserFactsStoreState>((set) => ({
    ...initialState,
    replaceUserFacts(users) {
        const list = Array.isArray(users) ? users.filter(isUserFactInput) : [];
        set((state) => {
            if (list.length === 0) {
                return state;
            }
            let usersByKey = state.usersByKey;
            let userIdsByEndpoint = state.userIdsByEndpoint;
            let order = state.order;
            let changed = false;
            for (const user of list) {
                const key = userFactKey(user.endpoint, user.id ?? user.userId);
                if (!key) {
                    continue;
                }
                const userFact = toUserFact(user, key);
                if (!userFact) {
                    continue;
                }
                if (!changed) {
                    usersByKey = { ...usersByKey };
                    userIdsByEndpoint = { ...userIdsByEndpoint };
                    order = [...order];
                    changed = true;
                }
                const isNew = !usersByKey[key];
                usersByKey[key] = userFact;
                const endpoint = endpointFromKey(key);
                if (isNew) {
                    if (!userIdsByEndpoint[endpoint]) {
                        userIdsByEndpoint[endpoint] = new Set();
                    }
                    userIdsByEndpoint[endpoint].add(userFact.id);
                    if (!userFact.isFriend) {
                        order.push(key);
                    }
                }
            }
            if (!changed) {
                return state;
            }
            for (const evictedKey of evictOverflow(
                order,
                USER_FACTS_NON_FRIEND_CAPACITY
            )) {
                const evicted = usersByKey[evictedKey];
                if (evicted?.isFriend) {
                    continue;
                }
                delete usersByKey[evictedKey];
                userIdsByEndpoint[endpointFromKey(evictedKey)]?.delete(
                    evicted?.id ?? ''
                );
            }
            const nextState = {
                usersByKey,
                userIdsByEndpoint,
                order
            };
            return nextState;
        });
    },
    resetUserFacts() {
        set(initialState);
    }
}));

export type { UserFactsStoreState };
