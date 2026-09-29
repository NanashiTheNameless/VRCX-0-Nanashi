// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    NAV_MENU_COLLAPSE_DELAY_MS,
    scheduleKeyboardSidebarToggleCleanup,
    subscribeToReducedMotionChanges,
    type ReducedMotionMediaQuery,
    useDelayedNavMenuCollapsed,
    useSidebarInstantTransition
} from './navMenuCollapse';

function stubReducedMotion(prefersReducedMotion: boolean) {
    const mediaQuery: ReducedMotionMediaQuery = {
        matches: prefersReducedMotion,
        addEventListener() {},
        removeEventListener() {}
    };
    vi.stubGlobal('matchMedia', () => mediaQuery);
}

describe('navMenuCollapse', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps expanded menu content until the collapse transition finishes', () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ sidebarOpen }) => useDelayedNavMenuCollapsed(sidebarOpen),
            { initialProps: { sidebarOpen: true } }
        );
        expect(result.current).toBe(false);

        rerender({ sidebarOpen: false });
        act(() => vi.advanceTimersByTime(NAV_MENU_COLLAPSE_DELAY_MS - 1));
        expect(result.current).toBe(false);

        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe(true);
    });

    it('keeps collapsed menu content until the expand transition finishes', () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ sidebarOpen }) => useDelayedNavMenuCollapsed(sidebarOpen),
            { initialProps: { sidebarOpen: false } }
        );
        expect(result.current).toBe(true);

        rerender({ sidebarOpen: true });
        act(() => vi.advanceTimersByTime(NAV_MENU_COLLAPSE_DELAY_MS - 1));
        expect(result.current).toBe(true);

        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe(false);
    });

    it('switches immediately for keyboard collapse and expand', () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ sidebarOpen }) => useDelayedNavMenuCollapsed(sidebarOpen, true),
            { initialProps: { sidebarOpen: true } }
        );
        expect(result.current).toBe(false);

        rerender({ sidebarOpen: false });
        expect(result.current).toBe(true);

        rerender({ sidebarOpen: true });
        expect(result.current).toBe(false);
    });

    it('does not apply a pending delayed switch after the sidebar is reopened', () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ sidebarOpen }) => useDelayedNavMenuCollapsed(sidebarOpen),
            { initialProps: { sidebarOpen: true } }
        );

        rerender({ sidebarOpen: false });
        act(() => vi.advanceTimersByTime(NAV_MENU_COLLAPSE_DELAY_MS - 1));
        rerender({ sidebarOpen: true });
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe(false);
        act(() => vi.advanceTimersByTime(NAV_MENU_COLLAPSE_DELAY_MS));
        expect(result.current).toBe(false);
    });

    it.each([
        [true, false, false, true],
        [false, true, false, true],
        [false, false, true, true],
        [false, false, false, false]
    ])(
        'resolves instant sidebar transitions from keyboard=%s, blur=%s, reduced motion=%s',
        (
            keyboardToggleActive,
            reducedMotionAndBlur,
            prefersReducedMotion,
            expected
        ) => {
            stubReducedMotion(prefersReducedMotion);
            const { result } = renderHook(() =>
                useSidebarInstantTransition(
                    keyboardToggleActive,
                    reducedMotionAndBlur
                )
            );
            expect(result.current).toBe(expected);
        }
    );

    it('responds to operating-system reduced-motion changes', () => {
        const listeners = new Set<(event: { matches: boolean }) => void>();
        const mediaQuery: ReducedMotionMediaQuery = {
            matches: false,
            addEventListener(_type, listener) {
                listeners.add(listener);
            },
            removeEventListener(_type, listener) {
                listeners.delete(listener);
            }
        };
        const changes: boolean[] = [];
        const unsubscribe = subscribeToReducedMotionChanges(
            mediaQuery,
            (matches) => changes.push(matches)
        );

        listeners.forEach((listener) => listener({ matches: true }));
        unsubscribe();
        listeners.forEach((listener) => listener({ matches: false }));

        expect(changes).toEqual([true]);
    });

    it('cleans up the scheduled keyboard transition reset', () => {
        let frameCallback: FrameRequestCallback | null = null;
        let cancelledFrameId: number | null = null;
        const scheduler = {
            requestAnimationFrame(callback: FrameRequestCallback) {
                frameCallback = callback;
                return 7;
            },
            cancelAnimationFrame(frameId: number) {
                cancelledFrameId = frameId;
            }
        };
        const cleanup = scheduleKeyboardSidebarToggleCleanup(
            () => {},
            scheduler
        );

        expect(frameCallback).not.toBeNull();
        cleanup();
        expect(cancelledFrameId).toBe(7);
    });

    it('defers the keyboard transition reset until the next animation frame', () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        let reset = false;
        const scheduler = {
            requestAnimationFrame(callback: FrameRequestCallback) {
                frameCallbacks.push(callback);
                return 8;
            },
            cancelAnimationFrame() {}
        };

        scheduleKeyboardSidebarToggleCleanup(() => {
            reset = true;
        }, scheduler);

        expect(reset).toBe(false);
        frameCallbacks[0]?.(0);
        expect(reset).toBe(true);
    });
});
