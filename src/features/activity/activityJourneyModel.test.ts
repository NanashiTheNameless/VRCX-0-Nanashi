import { describe, expect, it } from 'vitest';

import type {
    ActivityJourneyCompanion,
    ActivityJourneyVisit
} from '@/platform/tauri/bindings';

import {
    buildJourneyVisitView,
    JOURNEY_DENSITY_LIMITS,
    groupJourneyVisitsByDay,
    journeyDayBounds,
    journeyDaysInRange,
    journeyPageWindow,
    mergeJourneyVisits,
    summarizeJourneyDay
} from './activityJourneyModel';

const MINUTE = 60_000;
const DENSE = JOURNEY_DENSITY_LIMITS.dense;

function companion(
    userId: string,
    sharedMinutes: number,
    isFriend = false
): ActivityJourneyCompanion {
    return {
        userId,
        displayName: userId,
        isFriend,
        sharedMs: sharedMinutes * MINUTE
    };
}

function visit(
    minutes: number,
    companions: ActivityJourneyCompanion[] = [],
    startMs = 0
): ActivityJourneyVisit {
    return {
        location: 'wrld_a:1~friends',
        worldId: 'wrld_a',
        worldName: 'Alpha',
        worldImageUrl: '',
        startMs,
        endMs: startMs + minutes * MINUTE,
        companions
    };
}

describe('buildJourneyVisitView', () => {
    it('lists friends and favorites first and strangers only in small instances', () => {
        const small = buildJourneyVisitView(
            visit(60, [
                companion('usr_stranger', 50),
                companion('usr_friend', 10, true),
                companion('usr_fav', 5)
            ]),
            new Set(['usr_fav']),
            0,
            '',
            DENSE
        );

        expect(small.shownPeople.map((person) => person.userId)).toEqual([
            'usr_friend',
            'usr_fav',
            'usr_stranger'
        ]);
        expect(small.friendCount).toBe(2);

        const crowd = buildJourneyVisitView(
            visit(60, [
                companion('usr_friend', 10, true),
                ...Array.from({ length: 20 }, (_, index) =>
                    companion(`usr_${index}`, 30)
                )
            ]),
            new Set(),
            0,
            '',
            DENSE
        );

        expect(crowd.shownPeople.map((person) => person.userId)).toEqual([
            'usr_friend'
        ]);
        expect(crowd.otherPeople).toHaveLength(20);
        expect(crowd.peopleCount).toBe(21);
    });

    it('shows at most two strangers', () => {
        const view = buildJourneyVisitView(
            visit(60, [
                companion('usr_a', 50),
                companion('usr_b', 40),
                companion('usr_c', 30),
                companion('usr_friend', 10, true)
            ]),
            new Set(),
            0,
            '',
            DENSE
        );

        expect(view.shownPeople.map((person) => person.userId)).toEqual([
            'usr_friend',
            'usr_a',
            'usr_b'
        ]);
        expect(view.peopleCount).toBe(4);
    });

    it('lists every friend', () => {
        const view = buildJourneyVisitView(
            visit(
                60,
                Array.from({ length: 9 }, (_, index) =>
                    companion(`usr_${index}`, 9 - index, true)
                )
            ),
            new Set(),
            0,
            '',
            DENSE
        );

        expect(view.shownPeople).toHaveLength(9);
    });

    it('treats short solo visits without screenshots as brief', () => {
        expect(
            buildJourneyVisitView(visit(3), new Set(), 0, '', DENSE).brief
        ).toBe(true);
        expect(
            buildJourneyVisitView(visit(3), new Set(), 2, '', DENSE).brief
        ).toBe(false);
        expect(
            buildJourneyVisitView(
                visit(3, [companion('usr_friend', 3, true)]),
                new Set(),
                0,
                '',
                DENSE
            ).brief
        ).toBe(false);
        expect(
            buildJourneyVisitView(visit(30), new Set(), 0, '', DENSE).brief
        ).toBe(false);
    });

    it('folds long solo home world stays without screenshots', () => {
        expect(
            buildJourneyVisitView(visit(120), new Set(), 0, 'wrld_a', DENSE)
                .brief
        ).toBe(true);
        expect(
            buildJourneyVisitView(visit(120), new Set(), 1, 'wrld_a', DENSE)
                .brief
        ).toBe(false);
        expect(
            buildJourneyVisitView(
                visit(120, [companion('usr_friend', 60, true)]),
                new Set(),
                0,
                'wrld_a',
                DENSE
            ).brief
        ).toBe(false);
    });
});

describe('summarizeJourneyDay', () => {
    it('counts distinct worlds and friends', () => {
        const visits = [
            visit(120, [companion('usr_friend', 60, true)]),
            {
                ...visit(30, [
                    companion('usr_friend', 30, true),
                    companion('usr_stranger', 30)
                ]),
                worldId: 'wrld_b'
            }
        ];

        expect(summarizeJourneyDay(visits, new Set())).toEqual({
            worldCount: 2,
            friendCount: 1
        });
    });
});

describe('journey paging', () => {
    const days = ['2026-10-01', '2026-10-03', '2026-10-05'];

    it('lists active days newest first, limited to the picked range', () => {
        expect(journeyDaysInRange(days, null, null)).toEqual([
            '2026-10-05',
            '2026-10-03',
            '2026-10-01'
        ]);
        const picked = journeyDayBounds('2026-10-03');
        expect(
            journeyDaysInRange(days, picked.fromMs, picked.toMs - 1)
        ).toEqual(['2026-10-03']);
    });

    it('spans a page of days and clips it to the picked range', () => {
        const newestFirst = journeyDaysInRange(days, null, null);
        expect(journeyPageWindow(newestFirst, 0, null, null)).toEqual({
            fromMs: journeyDayBounds('2026-10-01').fromMs,
            toMs: journeyDayBounds('2026-10-05').toMs
        });
        const picked = journeyDayBounds('2026-10-03');
        expect(
            journeyPageWindow(['2026-10-03'], 0, picked.fromMs + 1, null)
        ).toEqual({ fromMs: picked.fromMs + 1, toMs: picked.toMs });
        expect(journeyPageWindow(newestFirst, 3, null, null)).toBeNull();
    });

    it('drops visits repeated across pages and groups them by start day', () => {
        const day = journeyDayBounds('2026-10-05');
        const crossing = visit(120, [], day.fromMs - 60 * MINUTE);
        const late = visit(30, [], day.fromMs + 600 * MINUTE);
        const merged = mergeJourneyVisits([late, crossing], [crossing]);

        expect(merged).toEqual([late, crossing]);
        expect(
            groupJourneyVisitsByDay(merged).map((group) => group.dayKey)
        ).toEqual(['2026-10-05', '2026-10-04']);
    });
});
