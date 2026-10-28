// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setDisplayTimeZone } from '@/shared/utils/displayTimeZone';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useShellStore } from '@/state/shellStore';

import { TimestampText } from './TimestampText';

describe('TimestampText', () => {
    beforeEach(() => {
        setDisplayTimeZone('UTC');
        useShellStore.setState({
            locale: 'en',
            dateCulture: 'en-gb',
            dateIsoFormat: false,
            dateHour12: false,
            dateFormat: 'locale'
        });
    });

    afterEach(() => {
        cleanup();
        setDisplayTimeZone('');
        usePreferencesStore.setState({ dtTimeZone: '' });
    });

    it('re-renders when the clock preference changes', () => {
        render(
            <TimestampText
                value="2026-06-04T19:20:02Z"
                format="time"
                tooltip={false}
            />
        );
        expect(screen.getByText('19:20')).toBeTruthy();

        act(() => {
            useShellStore.setState({ dateHour12: true });
        });

        expect(screen.queryByText('19:20')).toBeNull();
        expect(screen.getByText(/7:20/)).toBeTruthy();
    });

    it('re-renders when the date format or display timezone changes', () => {
        render(
            <TimestampText
                value="2026-06-04T19:20:02Z"
                format="time"
                tooltip={false}
            />
        );
        expect(screen.getByText('19:20')).toBeTruthy();

        act(() => {
            useShellStore.setState({ dateFormat: 'time-mdy' });
        });
        expect(screen.getByText('19:20:02')).toBeTruthy();

        act(() => {
            setDisplayTimeZone('Asia/Tokyo');
            usePreferencesStore.setState({ dtTimeZone: 'Asia/Tokyo' });
        });
        expect(screen.getByText('04:20:02')).toBeTruthy();
    });

    it('renders the empty placeholder for missing values', () => {
        render(<TimestampText value="" emptyText="—" />);

        expect(screen.getByText('—')).toBeTruthy();
    });
});
