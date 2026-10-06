// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePreferencesStore } from '@/state/preferencesStore';

import { DateRangeFilter } from './DateRangeFilter';

describe('DateRangeFilter tooltip composition', () => {
    afterEach(cleanup);

    it('keeps the calendar usable after hover and after closing', async () => {
        const onChange = vi.fn();
        render(
            <DateRangeFilter
                dateFrom="2026-09-01"
                dateTo="2026-09-02"
                onChange={onChange}
                label="Date range"
            />
        );
        const user = userEvent.setup();
        const trigger = screen.getByRole('button', {
            name: 'Date range: 2026-09-01 - 2026-09-02'
        });
        await user.hover(trigger);
        expect(
            (
                await screen.findByText('2026-09-01 - 2026-09-02', {
                    selector: '[data-slot="tooltip-content"]'
                })
            ).textContent
        ).toBe('2026-09-01 - 2026-09-02');
        await user.click(trigger);
        expect(await screen.findByRole('dialog')).toBeTruthy();
        await user.keyboard('{Escape}');
        await user.click(trigger);
        const popup = await screen.findByRole('dialog');
        await user.click(
            within(popup).getByRole('button', {
                name: 'common.actions.confirm'
            })
        );
        expect(onChange).toHaveBeenCalledWith('2026-09-01', '2026-09-02');
        expect(document.querySelector('button button')).toBeNull();
        await user.click(trigger);
        await user.click(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: 'common.actions.clear'
            })
        );
        expect(onChange).toHaveBeenLastCalledWith('', '');
    });

    it.each([
        [1, 'Monday'],
        [0, 'Sunday'],
        [6, 'Saturday']
    ] as const)(
        'starts calendar weeks on the preferred day %i',
        async (weekStartsOn, firstWeekday) => {
            usePreferencesStore.setState({ weekStartsOn });
            render(
                <DateRangeFilter
                    dateFrom="2026-09-01"
                    dateTo="2026-09-02"
                    onChange={vi.fn()}
                    label="Date range"
                />
            );
            await userEvent.setup().click(
                screen.getByRole('button', {
                    name: 'Date range: 2026-09-01 - 2026-09-02'
                })
            );
            const popup = await screen.findByRole('dialog');
            expect(
                popup
                    .querySelector('.rdp-weekdays th')
                    ?.getAttribute('aria-label')
            ).toBe(firstWeekday);
        }
    );
});
