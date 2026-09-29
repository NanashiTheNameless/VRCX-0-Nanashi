// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MutualFriendsAutoFetch } from './MutualFriendsAutoFetch';

function CurrentLocation() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

function renderAt(entry: string, currentUserId: string, onFetch = vi.fn()) {
    const view = render(
        <MemoryRouter initialEntries={[entry]}>
            <MutualFriendsAutoFetch
                currentUserId={currentUserId}
                onFetch={onFetch}
            />
            <CurrentLocation />
        </MemoryRouter>
    );
    return { ...view, onFetch };
}

afterEach(cleanup);

describe('MutualFriendsAutoFetch', () => {
    it('starts one fetch when opened from a build hint and clears the request', () => {
        const onFetch = vi.fn();
        render(
            <StrictMode>
                <MemoryRouter initialEntries={['/charts/mutual?fetch=1']}>
                    <MutualFriendsAutoFetch
                        currentUserId="usr_self"
                        onFetch={onFetch}
                    />
                    <CurrentLocation />
                </MemoryRouter>
            </StrictMode>
        );

        expect(onFetch).toHaveBeenCalledOnce();
        expect(screen.getByRole('status').textContent).toBe('/charts/mutual');
    });

    it('waits for the signed-in account before fetching', () => {
        const { onFetch } = renderAt('/charts/mutual?fetch=1', '');

        expect(onFetch).not.toHaveBeenCalled();
        expect(screen.getByRole('status').textContent).toBe(
            '/charts/mutual?fetch=1'
        );
    });

    it('does nothing when the graph page is opened normally', () => {
        const { onFetch } = renderAt('/charts/mutual', 'usr_self');

        expect(onFetch).not.toHaveBeenCalled();
    });
});
