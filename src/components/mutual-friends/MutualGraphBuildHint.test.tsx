// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

import { MutualGraphBuildHint } from './MutualGraphBuildHint';

function CurrentLocation() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

afterEach(cleanup);

describe('MutualGraphBuildHint', () => {
    it('stops the current work and opens the friend graph with a fetch request', () => {
        const onBeforeNavigate = vi.fn();
        render(
            <MemoryRouter initialEntries={['/player-list']}>
                <MutualGraphBuildHint onBeforeNavigate={onBeforeNavigate} />
                <CurrentLocation />
            </MemoryRouter>
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'mutual_graph_hint.build' })
        );

        expect(onBeforeNavigate).toHaveBeenCalledOnce();
        expect(screen.getByRole('status').textContent).toBe(
            '/charts/mutual?fetch=1'
        );
    });
});
