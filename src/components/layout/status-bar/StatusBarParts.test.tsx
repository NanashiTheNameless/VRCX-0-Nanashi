// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusDot } from './StatusBarParts';

const animate = vi.fn(() => ({ cancel: vi.fn() }));

beforeEach(() => {
    animate.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: animate
    });
});

afterEach(cleanup);

describe('StatusDot', () => {
    it('blinks three times when it turns yellow and again when it turns red', () => {
        const { rerender } = render(<StatusDot active alert={null} />);
        expect(animate).not.toHaveBeenCalled();

        rerender(<StatusDot active={false} alert="warn" />);
        expect(animate).toHaveBeenCalledTimes(1);
        expect(animate).toHaveBeenLastCalledWith(
            [{ opacity: 1 }, { opacity: 0.15 }],
            expect.objectContaining({ iterations: 6, direction: 'alternate' })
        );

        rerender(<StatusDot active={false} alert="danger" />);
        expect(animate).toHaveBeenCalledTimes(2);

        rerender(<StatusDot active alert={null} />);
        expect(animate).toHaveBeenCalledTimes(2);
    });
});
