import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/state/shellStore';

import {
    formatFeedExactTime,
    formatFeedRelativeTime,
    resolveFeedColumnTimeDisplay
} from './feedTimeDisplay';

const BASE_TIME = new Date('2026-06-04T09:20:02').getTime();
const translate = ((key: string) => key) as TFunction;

describe('feedTimeDisplay', () => {
    beforeEach(() => {
        useShellStore.setState({
            locale: 'zh-CN',
            dateCulture: 'en-gb',
            dateIsoFormat: false,
            dateHour12: false,
            dateFormat: 'locale'
        });
    });

    it('formats relative feed time with the app locale', () => {
        expect(
            formatFeedRelativeTime('2026-06-04T07:20:02', BASE_TIME, translate)
        ).toBe(
            new Intl.RelativeTimeFormat('zh-CN', {
                numeric: 'auto',
                style: 'short'
            }).format(-2, 'hour')
        );
    });

    it('formats exact feed time with the shared app-locale date helper', () => {
        const value = '2026-06-04T07:20:02';

        expect(formatFeedExactTime(value, 'short')).toBe('2026年6月4日 7:20');
    });

    it('shows only the time for exact feed column labels from today', () => {
        expect(
            resolveFeedColumnTimeDisplay({
                mode: 'exact',
                nowMs: BASE_TIME,
                t: translate,
                value: '2026-06-04T07:20:02'
            }).label
        ).toBe('7:20');
    });

    it('keeps the full date for exact feed column labels from earlier days', () => {
        expect(
            resolveFeedColumnTimeDisplay({
                mode: 'exact',
                nowMs: BASE_TIME,
                t: translate,
                value: '2026-06-03T07:20:02'
            }).label
        ).toBe('2026年6月3日 7:20');
    });

    it('follows the selected date format for exact feed column labels', () => {
        useShellStore.setState({ dateFormat: 'time-mdy', dateHour12: true });

        expect(
            resolveFeedColumnTimeDisplay({
                mode: 'exact',
                nowMs: BASE_TIME,
                t: translate,
                value: '2026-06-03T19:20:02'
            }).label
        ).toBe('07:20:02 PM 06/03/26');
        expect(
            resolveFeedColumnTimeDisplay({
                mode: 'exact',
                nowMs: BASE_TIME,
                t: translate,
                value: '2026-06-04T07:20:02'
            }).label
        ).toBe('07:20:02 AM');
    });
});
