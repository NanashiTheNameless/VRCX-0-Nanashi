// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedThemeToggler } from '@/ui/shadcn/animated-theme-toggler';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/ui/shadcn/tooltip';

describe('AnimatedThemeToggler', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 1000
        });
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 800
        });
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }))
        );
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.classList.remove('dark');
        delete document.documentElement.dataset.magicuiThemeVt;
    });

    it('draws the overlay effect without the View Transitions API', async () => {
        const onThemeChange = vi.fn();
        const startViewTransition = vi.fn();
        document.startViewTransition = startViewTransition;
        const animations: Keyframe[][] = [];
        const animate = vi.fn(
            (keyframes: Keyframe[] | PropertyIndexedKeyframes) => {
                animations.push(keyframes as Keyframe[]);
                return { cancel: vi.fn(), finished: Promise.resolve() };
            }
        );
        Object.defineProperty(HTMLElement.prototype, 'animate', {
            configurable: true,
            value: animate
        });

        render(
            <AnimatedThemeToggler
                theme="light"
                animation="overlay"
                onThemeChange={onThemeChange}
                aria-label="toggle theme"
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'toggle theme' }));

        await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith('dark'));
        expect(startViewTransition).not.toHaveBeenCalled();
        expect(animate).toHaveBeenCalledTimes(2);
        expect(animations[1]).toEqual({ opacity: [1, 0] });
        await waitFor(() =>
            expect(document.querySelector('div[aria-hidden="true"]')).toBeNull()
        );
        delete (HTMLElement.prototype as { animate?: unknown }).animate;
    });

    it('switches instantly without a View Transition when not animated', () => {
        const onThemeChange = vi.fn();
        const startViewTransition = vi.fn();
        document.startViewTransition = startViewTransition;

        render(
            <AnimatedThemeToggler
                theme="light"
                animation="none"
                onThemeChange={onThemeChange}
                aria-label="toggle theme"
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'toggle theme' }));

        expect(onThemeChange).toHaveBeenCalledWith('dark');
        expect(startViewTransition).not.toHaveBeenCalled();
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('switches to the next theme and reveals it from the button center', async () => {
        const onThemeChange = vi.fn();
        let finishTransition: () => void = () => undefined;
        const finished = new Promise<void>((resolve) => {
            finishTransition = resolve;
        });
        const animate = vi.fn(() => ({
            cancel: vi.fn(),
            finished
        }));
        Object.defineProperty(document.documentElement, 'animate', {
            configurable: true,
            value: animate
        });
        document.startViewTransition = vi.fn((update) => {
            update();
            return {
                ready: Promise.resolve(),
                finished,
                updateCallbackDone: finished,
                skipTransition: vi.fn(),
                types: new Set<string>()
            };
        });

        render(
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <span>
                                <AnimatedThemeToggler
                                    theme="light"
                                    onThemeChange={onThemeChange}
                                    aria-label="toggle theme"
                                />
                            </span>
                        }
                    />
                    <TooltipContent>toggle theme</TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
        const button = screen.getByRole('button', { name: 'toggle theme' });
        vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(880, 20, 40, 40)
        );

        fireEvent.click(button);

        expect(onThemeChange).toHaveBeenCalledWith('dark');
        await waitFor(() => expect(animate).toHaveBeenCalledOnce());
        expect(animate).toHaveBeenCalledWith(
            {
                clipPath: [
                    'circle(0% at 90% 5%)',
                    expect.stringContaining('at 90% 5%)')
                ]
            },
            expect.anything()
        );
        finishTransition();
    });
});
