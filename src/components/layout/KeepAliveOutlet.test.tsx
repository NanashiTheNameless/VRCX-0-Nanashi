// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { useState } from 'react';
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useNavigate
} from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { KeepAliveOutlet } from './KeepAliveOutlet';

const locationsSeen: Record<string, string[]> = {};

function Counter({ name }: { name: string }) {
    const [count, setCount] = useState(0);
    const location = useLocation();
    (locationsSeen[name] ??= []).push(location.pathname + location.search);
    return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
            {name}:{count}
        </button>
    );
}

let navigateTo: (to: string) => void = () => undefined;
function NavigateHandle() {
    navigateTo = useNavigate();
    return null;
}

function renderRoutes(limit?: number) {
    return render(
        <MemoryRouter initialEntries={['/a']}>
            <NavigateHandle />
            <Routes>
                <Route element={<KeepAliveOutlet limit={limit} />}>
                    <Route path="a" element={<Counter name="a" />} />
                    <Route path="b" element={<Counter name="b" />} />
                    <Route path="c" element={<Counter name="c" />} />
                </Route>
            </Routes>
        </MemoryRouter>
    );
}

describe('KeepAliveOutlet', () => {
    afterEach(() => {
        cleanup();
        for (const key of Object.keys(locationsSeen)) {
            delete locationsSeen[key];
        }
    });

    it('keeps a visited page state when returning to it', () => {
        renderRoutes();
        fireEvent.click(screen.getByText('a:0'));
        expect(screen.getByText('a:1')).toBeTruthy();

        act(() => navigateTo('/b'));
        expect(screen.getByText('b:0')).toBeTruthy();
        act(() => navigateTo('/a'));

        expect(screen.getByText('a:1')).toBeTruthy();
    });

    it('never shows a hidden page another page location', () => {
        renderRoutes();
        act(() => navigateTo('/b?tab=x'));

        expect(locationsSeen.a).not.toContain('/b?tab=x');
    });

    it('drops the least recently used page past the limit', () => {
        renderRoutes(2);
        fireEvent.click(screen.getByText('a:0'));
        act(() => navigateTo('/b'));
        act(() => navigateTo('/c'));
        act(() => navigateTo('/a'));

        expect(screen.getByText('a:0')).toBeTruthy();
    });
});
