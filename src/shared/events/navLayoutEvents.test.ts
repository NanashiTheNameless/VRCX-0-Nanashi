// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
    NAV_SHORTCUT_REQUESTED_EVENT,
    publishNavShortcutRequested
} from './navLayoutEvents';

describe('navLayoutEvents', () => {
    it('publishes only valid one-based navigation shortcut positions', () => {
        const positions: number[] = [];
        const handleShortcut = (event: Event) => {
            if (
                event instanceof CustomEvent &&
                typeof event.detail === 'number'
            ) {
                positions.push(event.detail);
            }
        };
        window.addEventListener(NAV_SHORTCUT_REQUESTED_EVENT, handleShortcut);

        publishNavShortcutRequested(1);
        publishNavShortcutRequested(9);
        publishNavShortcutRequested(0);
        publishNavShortcutRequested(10);

        expect(positions).toEqual([1, 9]);

        window.removeEventListener(
            NAV_SHORTCUT_REQUESTED_EVENT,
            handleShortcut
        );
    });
});
