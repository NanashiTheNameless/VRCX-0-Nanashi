// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({
    recordRouteError: vi.fn()
}));

vi.mock('@/services/telemetry/telemetryPageReach', () => ({
    recordRouteError: telemetryMocks.recordRouteError
}));

import { classifyRouteError, RouteErrorBoundary } from './RouteErrorBoundary';

function ThrowingRoute({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new TypeError('bad props');
    }
    return <span>content</span>;
}

describe('classifyRouteError', () => {
    it('classifies chunk loading failures as load_fail', () => {
        expect(classifyRouteError(new Error('Loading chunk 123 failed'))).toBe(
            'load_fail'
        );
        expect(
            classifyRouteError(
                new Error('Failed to fetch dynamically imported module')
            )
        ).toBe('load_fail');
    });

    it('classifies other render exceptions as render_crash', () => {
        expect(classifyRouteError(new TypeError('bad props'))).toBe(
            'render_crash'
        );
        expect(classifyRouteError('unexpected')).toBe('render_crash');
    });
});

describe('RouteErrorBoundary', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        telemetryMocks.recordRouteError.mockReset();
    });

    it('shows the fallback and records a render crash when a route throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(
            <RouteErrorBoundary resetKey="route-a" fallback={<p>fallback</p>}>
                <ThrowingRoute shouldThrow />
            </RouteErrorBoundary>
        );

        expect(screen.getByText('fallback')).toBeTruthy();
        expect(screen.queryByText('content')).toBeNull();
        expect(telemetryMocks.recordRouteError).toHaveBeenCalledWith(
            'render_crash',
            expect.any(TypeError)
        );
    });

    it('renders the route again after navigating to a new reset key', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { rerender } = render(
            <RouteErrorBoundary resetKey="route-a" fallback={<p>fallback</p>}>
                <ThrowingRoute shouldThrow />
            </RouteErrorBoundary>
        );
        expect(screen.getByText('fallback')).toBeTruthy();

        rerender(
            <RouteErrorBoundary resetKey="route-b" fallback={<p>fallback</p>}>
                <ThrowingRoute shouldThrow={false} />
            </RouteErrorBoundary>
        );

        expect(screen.getByText('content')).toBeTruthy();
        expect(screen.queryByText('fallback')).toBeNull();
    });
});
