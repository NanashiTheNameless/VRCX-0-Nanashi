import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';

import { userActivityViewService } from './userActivityViewService';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appActivityView: vi.fn(),
        appActivityOverlapView: vi.fn()
    }
}));

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe('userActivityViewService Rust activity views', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-21T10:30:15.250Z'));
        setDisplayTimeZone('UTC');
        vi.mocked(commands.appActivityView).mockReset();
        vi.mocked(commands.appActivityOverlapView).mockReset();
    });
    afterEach(() => {
        setDisplayTimeZone('');
        vi.useRealTimers();
    });

    it('loads activity view from Rust and formats peak labels', async () => {
        vi.mocked(commands.appActivityView).mockResolvedValue({
            rawBuckets: [60],
            normalizedBuckets: [0.5],
            peakDayIndex: 0,
            peakHourStart: 1,
            peakHourEnd: 3,
            filteredEventCount: 1,
            hasAnyData: true,
            builtFromCursor: 'cursor',
            builtAt: 1736121600
        });

        const result = await userActivityViewService.loadActivityView({
            userId: 'usr_target',
            ownerUserId: 'usr_owner',
            isSelf: false,
            rangeDays: 7,
            dayLabels,
            forceRefresh: true
        });

        expect(commands.appActivityView).toHaveBeenCalledWith({
            ownerUserId: 'usr_owner',
            targetUserId: 'usr_target',
            isSelf: false,
            rangeDays: 7,
            utcOffsetMinutes: 0,
            now: 1784629815,
            forceRefresh: true
        });
        expect(result).toMatchObject({
            rawBuckets: [60],
            normalizedBuckets: [0.5],
            filteredEventCount: 1,
            hasAnyData: true,
            peakDay: 'Sun',
            peakTime: '01:00-03:00'
        });
    });

    it('formats single-hour activity peaks without a range suffix', async () => {
        setDisplayTimeZone('UTC+05:45');
        vi.mocked(commands.appActivityView).mockResolvedValue({
            rawBuckets: [60],
            normalizedBuckets: [1],
            peakDayIndex: 2,
            peakHourStart: 9,
            peakHourEnd: 10,
            filteredEventCount: 1,
            hasAnyData: true,
            builtFromCursor: 'cursor',
            builtAt: 1736121600
        });

        const result = await userActivityViewService.loadActivityView({
            userId: 'usr_self',
            ownerUserId: '',
            isSelf: true,
            rangeDays: 30,
            dayLabels
        });

        expect(result.peakDay).toBe('Tue');
        expect(result.peakTime).toBe('09:00');
        expect(commands.appActivityView).toHaveBeenCalledWith(
            expect.objectContaining({ utcOffsetMinutes: 345, now: 1784629815 })
        );
    });

    it('loads overlap view from Rust and formats best overlap labels', async () => {
        vi.mocked(commands.appActivityOverlapView).mockResolvedValue({
            rawBuckets: [0, 0, 60, 60],
            normalizedBuckets: [0, 0, 0.8, 0.8],
            overlapPercent: 100,
            bestDayIndex: 0,
            bestHourStart: 2,
            bestHourEnd: 4,
            hasOverlapData: true,
            builtFromCursor: 'self|target',
            builtAt: 1736121600
        });

        const result = await userActivityViewService.loadOverlapView({
            currentUserId: 'usr_owner',
            targetUserId: 'usr_target',
            ownerUserId: 'usr_owner',
            rangeDays: 7,
            dayLabels,
            forceRefresh: false,
            excludeHours: {
                enabled: true,
                startHour: 22,
                endHour: 2
            }
        });

        expect(commands.appActivityOverlapView).toHaveBeenCalledWith({
            ownerUserId: 'usr_owner',
            currentUserId: 'usr_owner',
            targetUserId: 'usr_target',
            rangeDays: 7,
            utcOffsetMinutes: 0,
            now: 1784629815,
            forceRefresh: false,
            excludeStartHour: 22,
            excludeEndHour: 2
        });
        expect(result).toMatchObject({
            rawBuckets: [0, 0, 60, 60],
            normalizedBuckets: [0, 0, 0.8, 0.8],
            overlapPercent: 100,
            hasOverlapData: true,
            bestOverlapTime: 'Sun, 02:00-04:00'
        });
    });
});
