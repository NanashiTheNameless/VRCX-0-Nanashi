// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    restoreNormalWindowModeForIntent: vi.fn(),
    runAfterRestoringNormalWindow: vi.fn<(action: () => void) => void>()
}));

vi.mock('@/services/windowModeService', () => ({
    restoreNormalWindowModeForIntent: mocks.restoreNormalWindowModeForIntent,
    runAfterRestoringNormalWindow: mocks.runAfterRestoringNormalWindow
}));

import {
    registerLanguageCode,
    unregisterLanguageCode
} from '@/localization/locales';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import {
    setVrcxCssLayer,
    VRCX_CSS_LAYER_ATTR
} from '@/services/vrcx0CssLayerService';
import { NAV_SHORTCUT_REQUESTED_EVENT } from '@/shared/events/navLayoutEvents';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';

import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts';

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
}

function captureNavShortcutPositions() {
    const positions: number[] = [];
    const handleShortcut = (event: Event) => {
        if (event instanceof CustomEvent && typeof event.detail === 'number') {
            positions.push(event.detail);
        }
    };
    window.addEventListener(NAV_SHORTCUT_REQUESTED_EVENT, handleShortcut);
    return {
        positions,
        stop() {
            window.removeEventListener(
                NAV_SHORTCUT_REQUESTED_EVENT,
                handleShortcut
            );
        }
    };
}

describe('useGlobalKeyboardShortcuts', () => {
    beforeEach(() => {
        mocks.restoreNormalWindowModeForIntent.mockReset();
        mocks.runAfterRestoringNormalWindow
            .mockReset()
            .mockImplementation((action) => action());
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useShellStore.setState({ shortcutHintsVisible: false });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.useRealTimers();
        useShellStore.setState({ shortcutHintsVisible: false, locale: 'en' });
        unregisterLanguageCode('lol_us');
    });

    it.each(['/settings', '/login', '/tools/chatbox'])(
        'restores and saves English from a menu input on %s',
        async (pathname) => {
            registerLanguageCode('lol_us');
            useShellStore.setState({ locale: 'lol_us' });
            const save = vi
                .spyOn(configRepository, 'setString')
                .mockResolvedValue(null);
            vi.spyOn(configRepository, 'getString').mockResolvedValue('');
            renderHook(() => useGlobalKeyboardShortcuts(), {
                wrapper: ({ children }) => (
                    <MemoryRouter initialEntries={[pathname]}>
                        {children}
                    </MemoryRouter>
                )
            });
            const menu = document.createElement('div');
            menu.setAttribute('role', 'menu');
            menu.addEventListener('keydown', (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            const input = document.createElement('input');
            menu.append(input);
            document.body.append(menu);
            input.focus();
            const event = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                ctrlKey: true,
                altKey: true,
                shiftKey: true,
                key: 'L'
            });
            try {
                await act(async () => {
                    input.dispatchEvent(event);
                });
                expect(event.defaultPrevented).toBe(true);
                expect(useShellStore.getState().locale).toBe('en');
                expect(document.documentElement.lang).toBe('en');
                expect(save).toHaveBeenCalledExactlyOnceWith(
                    'appLanguage',
                    'en'
                );
            } finally {
                menu.remove();
            }
        }
    );

    it('restores English on macOS with a non-Latin keyboard layout without handling repeats', async () => {
        useShellStore.setState({ locale: 'lol_us' });
        useRuntimeStore.setState((state) => ({
            hostCapabilities: {
                ...state.hostCapabilities,
                platform: 'macos'
            }
        }));
        const save = vi
            .spyOn(configRepository, 'setString')
            .mockResolvedValue(null);
        vi.spyOn(configRepository, 'getString').mockResolvedValue('');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });
        const chord = {
            bubbles: true,
            cancelable: true,
            metaKey: true,
            altKey: true,
            shiftKey: true,
            key: '\u0414',
            code: 'KeyL'
        };
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', chord));
            window.dispatchEvent(
                new KeyboardEvent('keydown', { ...chord, repeat: true })
            );
        });
        expect(useShellStore.getState().locale).toBe('en');
        expect(save).toHaveBeenCalledExactlyOnceWith('appLanguage', 'en');
    });

    it('keeps English active and reports when saving the reset fails', async () => {
        useShellStore.setState({ locale: 'lol_us' });
        vi.spyOn(configRepository, 'setString').mockRejectedValue(
            new Error('Disk full')
        );
        const notify = vi.spyOn(toast, 'add');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    cancelable: true,
                    ctrlKey: true,
                    altKey: true,
                    shiftKey: true,
                    key: 'L'
                })
            );
        });
        expect(useShellStore.getState().locale).toBe('en');
        expect(notify).toHaveBeenCalledWith({
            type: 'error',
            title: 'shortcuts.language_reset_save_failed'
        });
    });

    it('toggles the keyboard shortcuts dialog with Ctrl+/', () => {
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        const openShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '/'
        });
        act(() => window.dispatchEvent(openShortcut));

        expect(openShortcut.defaultPrevented).toBe(true);
        expect(mocks.restoreNormalWindowModeForIntent).toHaveBeenCalledOnce();
        expect(
            useRuntimeStore.getState().systemHosts.keyboardShortcutsOpen
        ).toBe(true);

        const closeShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '/'
        });
        act(() => window.dispatchEvent(closeShortcut));

        expect(closeShortcut.defaultPrevented).toBe(true);
        expect(
            useRuntimeStore.getState().systemHosts.keyboardShortcutsOpen
        ).toBe(false);
    });

    it('publishes Ctrl and Command navigation shortcuts while the session is ready', () => {
        const captured = captureNavShortcutPositions();
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        const firstShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '1'
        });
        const ninthShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            key: '9',
            metaKey: true
        });
        act(() => {
            window.dispatchEvent(firstShortcut);
            window.dispatchEvent(ninthShortcut);
        });

        expect(firstShortcut.defaultPrevented).toBe(true);
        expect(ninthShortcut.defaultPrevented).toBe(true);
        expect(captured.positions).toEqual([1, 9]);
        expect(mocks.runAfterRestoringNormalWindow).toHaveBeenCalledTimes(2);

        captured.stop();
    });

    it('consumes navigation shortcuts without publishing while unavailable', () => {
        const captured = captureNavShortcutPositions();
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        const input = document.createElement('input');
        document.body.append(input);
        const editingShortcut = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: '5'
        });
        const repeatedShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '5',
            repeat: true
        });
        act(() => {
            input.dispatchEvent(editingShortcut);
            window.dispatchEvent(repeatedShortcut);
        });
        input.remove();

        useSessionStore.getState().setSessionPhase('signed_out');
        const signedOutShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '5'
        });
        act(() => window.dispatchEvent(signedOutShortcut));

        expect(editingShortcut.defaultPrevented).toBe(true);
        expect(repeatedShortcut.defaultPrevented).toBe(true);
        expect(signedOutShortcut.defaultPrevented).toBe(true);
        expect(captured.positions).toEqual([]);

        captured.stop();
    });

    it('leaves non-navigation digit chords untouched', () => {
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        const zeroShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '0'
        });
        const shiftedShortcut = new KeyboardEvent('keydown', {
            cancelable: true,
            ctrlKey: true,
            key: '1',
            shiftKey: true
        });
        const altShortcut = new KeyboardEvent('keydown', {
            altKey: true,
            cancelable: true,
            ctrlKey: true,
            key: '1'
        });
        act(() => {
            window.dispatchEvent(zeroShortcut);
            window.dispatchEvent(shiftedShortcut);
            window.dispatchEvent(altShortcut);
        });

        expect(zeroShortcut.defaultPrevented).toBe(false);
        expect(shiftedShortcut.defaultPrevented).toBe(false);
        expect(altShortcut.defaultPrevented).toBe(false);
    });

    it('shows shortcut hints only after holding the primary modifier', () => {
        vi.useFakeTimers();
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    ctrlKey: true,
                    key: 'Control'
                })
            );
            vi.advanceTimersByTime(159);
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);

        act(() => vi.advanceTimersByTime(1));
        expect(useShellStore.getState().shortcutHintsVisible).toBe(true);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    ctrlKey: true,
                    key: '1'
                })
            );
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);

        act(() => vi.advanceTimersByTime(200));
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Control'
                })
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    ctrlKey: true,
                    key: 'Control'
                })
            );
            vi.advanceTimersByTime(160);
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(true);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Control'
                })
            );
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    ctrlKey: true,
                    key: 'Control'
                })
            );
            vi.advanceTimersByTime(160);
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(true);

        act(() => {
            useSessionStore.getState().setSessionPhase('signed_out');
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);

        act(() => {
            useSessionStore.getState().setSessionPhase('ready');
        });
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    ctrlKey: true,
                    key: 'Control'
                })
            );
            vi.advanceTimersByTime(160);
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(true);

        act(() => window.dispatchEvent(new Event('blur')));
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);
    });

    it('shows shortcut hints while holding Command on macOS', () => {
        vi.useFakeTimers();
        useRuntimeStore.setState((state) => ({
            hostCapabilities: {
                ...state.hostCapabilities,
                platform: 'macos'
            }
        }));
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Meta',
                    metaKey: true
                })
            );
            vi.advanceTimersByTime(160);
        });

        expect(useShellStore.getState().shortcutHintsVisible).toBe(true);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Meta'
                })
            );
        });
        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);
    });

    it('does not show shortcut hints while editing text', () => {
        vi.useFakeTimers();
        useSessionStore.getState().setSessionPhase('ready');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();

        act(() => {
            input.dispatchEvent(
                new KeyboardEvent('keydown', {
                    bubbles: true,
                    ctrlKey: true,
                    key: 'Control'
                })
            );
            vi.advanceTimersByTime(200);
        });

        expect(useShellStore.getState().shortcutHintsVisible).toBe(false);
        input.remove();
    });

    it('toggles community theme CSS off and back on with Ctrl+Alt+Shift+T', () => {
        setVrcxCssLayer('installed-theme', 'body { color: red; }');
        renderHook(() => useGlobalKeyboardShortcuts(), { wrapper });
        const themeStyle = () =>
            document.head.querySelector(
                `style[${VRCX_CSS_LAYER_ATTR}="installed-theme"]`
            );
        const pressSafeMode = () =>
            act(() =>
                window.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        cancelable: true,
                        ctrlKey: true,
                        altKey: true,
                        shiftKey: true,
                        key: 'T'
                    })
                )
            );
        expect(themeStyle()).not.toBeNull();

        pressSafeMode();
        expect(themeStyle()).toBeNull();

        pressSafeMode();
        expect(themeStyle()).not.toBeNull();
        setVrcxCssLayer('installed-theme', '');
    });
});
