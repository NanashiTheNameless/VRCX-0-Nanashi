import { act } from '@testing-library/react';

import { onlineFeedEntry } from '@/components/feed/feedLiveTestEntries';
import { useFeedLiveStore } from '@/state/feedLiveStore';

export type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T): void;
};

export function createDeferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

export async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

export function pushLiveEntry(id: string, sequence?: number): void {
    act(() => {
        const state = useFeedLiveStore.getState();
        state.pushEntries(
            [
                {
                    sequence: sequence ?? state.version + 1,
                    entry: onlineFeedEntry({
                        userId: `usr_${id}`,
                        displayName: id,
                        created_at: 1786406400 + state.version
                    })
                }
            ],
            { ownerUserId: 'usr_self' }
        );
    });
}
