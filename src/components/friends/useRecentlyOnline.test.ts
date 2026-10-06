// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    gpsFeedEntry,
    onlineFeedEntry
} from '@/components/feed/feedLiveTestEntries';
import { useFeedLiveStore } from '@/state/feedLiveStore';

import { useRecentlyOnline } from './useRecentlyOnline';

const NOW = Date.parse('2026-08-11T00:00:10Z');

describe('useRecentlyOnline', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        useFeedLiveStore.getState().resetFeedLive();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('plays for three seconds after the friend Online feed event', () => {
        const { result } = renderHook(() => useRecentlyOnline('usr_friend'));
        expect(result.current).toBe(false);

        act(() => {
            useFeedLiveStore.getState().pushEntries([
                {
                    sequence: 1,
                    entry: onlineFeedEntry({
                        created_at: '2026-08-11T00:00:09.500Z'
                    })
                }
            ]);
        });
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(2_499);
        });
        expect(result.current).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe(false);
    });

    it('plays when the friend comes online already traveling', () => {
        act(() => {
            useFeedLiveStore.getState().pushEntries([
                {
                    sequence: 1,
                    entry: onlineFeedEntry({
                        location: 'traveling',
                        created_at: '2026-08-11T00:00:10Z'
                    })
                }
            ]);
        });

        const { result } = renderHook(() => useRecentlyOnline('usr_friend'));

        expect(result.current).toBe(true);
    });

    it('ignores other friends, other event types and stale Online events', () => {
        act(() => {
            useFeedLiveStore.getState().pushEntries([
                {
                    sequence: 1,
                    entry: onlineFeedEntry({
                        created_at: '2026-08-11T00:00:06Z'
                    })
                },
                {
                    sequence: 2,
                    entry: onlineFeedEntry({
                        userId: 'usr_other',
                        created_at: '2026-08-11T00:00:10Z'
                    })
                },
                {
                    sequence: 3,
                    entry: gpsFeedEntry({
                        created_at: '2026-08-11T00:00:10Z'
                    })
                }
            ]);
        });

        const { result } = renderHook(() => useRecentlyOnline('usr_friend'));

        expect(result.current).toBe(false);
    });
});
