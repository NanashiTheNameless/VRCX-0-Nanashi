// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSidebarDecorationHover } from './SidebarProfileDecorations';

afterEach(cleanup);

function HoverProbe() {
    const { active, hoverProps } = useSidebarDecorationHover();
    return (
        <div data-testid="row" data-active={String(active)} {...hoverProps}>
            <span data-testid="inner" />
        </div>
    );
}

function movePointerTo(target: Element) {
    act(() => {
        target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    });
}

describe('useSidebarDecorationHover', () => {
    it('stays active while the pointer moves inside the hovered element', () => {
        render(<HoverProbe />);
        const row = screen.getByTestId('row');

        fireEvent.pointerEnter(row);
        movePointerTo(screen.getByTestId('inner'));

        expect(row.dataset.active).toBe('true');
    });

    it('deactivates when the pointer moves elsewhere without a pointerleave, such as after a context menu closes', () => {
        render(<HoverProbe />);
        const row = screen.getByTestId('row');

        fireEvent.pointerEnter(row);
        movePointerTo(document.body);

        expect(row.dataset.active).toBe('false');
    });
});
