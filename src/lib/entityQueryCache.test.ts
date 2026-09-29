import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearEntityQueryCache,
    entityQueryPolicies,
    queryKeys
} from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';

describe('entityQueryCache', () => {
    afterEach(async () => {
        await clearEntityQueryCache();
        vi.useRealTimers();
    });

    it('builds stable query keys with sorted params and normalized endpoints', () => {
        expect(
            queryKeys.worldsByUser(
                {
                    userId: 'usr_123',
                    offset: 100,
                    n: 50,
                    sort: 'updated',
                    order: 'descending',
                    releaseStatus: 'all'
                },
                'https://api.example.test///'
            )
        ).toEqual([
            'worlds',
            'user',
            'usr_123',
            {
                n: 50,
                offset: 100,
                order: 'descending',
                releaseStatus: 'all',
                sort: 'updated',
                userId: 'usr_123'
            },
            {
                endpoint: 'https://api.example.test'
            }
        ]);

        expect(
            queryKeys.worldPersistData({
                worldId: 'wrld_123',
                userId: 'usr_123'
            })
        ).toEqual(['world', 'wrld_123', 'persistData', 'usr_123']);
    });

    it('retains observed user profiles and releases them five minutes after the last observer leaves', async () => {
        vi.useFakeTimers();
        const key = queryKeys.user('usr_observed');
        const observer = new QueryObserver(queryClient, {
            queryKey: key,
            queryFn: async () => ({ id: 'usr_observed' }),
            ...entityQueryPolicies.userAvatarLookup
        });
        const unsubscribe = observer.subscribe(() => {});
        await observer.refetch();
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(queryClient.getQueryData(key)).toEqual({ id: 'usr_observed' });
        unsubscribe();
        await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
        expect(queryClient.getQueryData(key)).toBeDefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(queryClient.getQueryData(key)).toBeUndefined();
    });
});
