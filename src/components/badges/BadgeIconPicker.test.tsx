// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BadgeIconPicker } from './BadgeIconPicker';
import { loadBadgeIcons } from './badgeIcons';

type Callback = (entries: { isIntersecting: boolean }[]) => void;

let reachBottom: () => void = () => {};

class FakeIntersectionObserver {
    constructor(callback: Callback) {
        reachBottom = () => callback([{ isIntersecting: true }]);
    }
    observe() {}
    disconnect() {}
}

function iconButtons() {
    return screen
        .getAllByRole('button')
        .filter((button) => button.hasAttribute('aria-pressed'));
}

describe('BadgeIconPicker', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('draws icons in batches and adds more as the list scrolls', async () => {
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
        const catalog = await loadBadgeIcons();
        render(<BadgeIconPicker value="Star" onValueChange={() => {}} />);
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.appearance.user_badges.icon'
            })
        );

        const first = iconButtons().length;
        expect(first).toBe(160);
        act(() => reachBottom());
        expect(iconButtons().length).toBe(320);
        // Every icon custom badges may use is reachable, Lab icons included.
        expect(catalog.names.length).toBeGreaterThan(2000);
    });

    it('says why icons are missing when a search matches reserved ones', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        await loadBadgeIcons();
        render(<BadgeIconPicker value="Star" onValueChange={() => {}} />);
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.appearance.user_badges.icon'
            })
        );
        const search = screen.getByRole('textbox');
        fireEvent.change(search, { target: { value: 'shield' } });
        expect(
            screen.getByText(
                'view.settings.appearance.user_badges.icon_reserved'
            )
        ).toBeTruthy();
        expect(iconButtons()).toEqual([]);
        fireEvent.change(search, { target: { value: 'heart' } });
        expect(
            screen.queryByText(
                'view.settings.appearance.user_badges.icon_reserved'
            )
        ).not.toBeNull();
        fireEvent.change(search, { target: { value: 'music' } });
        expect(
            screen.queryByText(
                'view.settings.appearance.user_badges.icon_reserved'
            )
        ).toBeNull();
    });

    it('draws every icon at once where scrolling cannot be observed', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        await loadBadgeIcons();
        render(<BadgeIconPicker value="Star" onValueChange={() => {}} />);
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.appearance.user_badges.icon'
            })
        );
        expect(iconButtons().length).toBeGreaterThan(1500);
    });
});
