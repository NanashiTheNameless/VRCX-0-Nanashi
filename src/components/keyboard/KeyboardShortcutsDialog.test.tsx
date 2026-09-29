// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';
import { useTrayShortcutStore } from '@/state/trayShortcutStore';

import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

beforeEach(() => {
    useRuntimeStore.setState((state) => ({
        hostCapabilities: { ...state.hostCapabilities, platform: 'windows' }
    }));
    useTrayShortcutStore.setState({
        snapshot: { binding: null, status: 'unset' }
    });
});

afterEach(() => {
    cleanup();
    useRuntimeStore.getState().resetRuntimeState();
    useTrayShortcutStore.setState({ snapshot: null });
});

describe('KeyboardShortcutsDialog', () => {
    it('keeps the tray shortcut visible and reflects setting and clearing it', async () => {
        render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />);

        expect(await screen.findByText('shortcuts.tray.title')).toBeTruthy();
        expect(screen.getByText('shortcuts.tray.unset')).toBeTruthy();

        act(() => {
            useTrayShortcutStore.setState({
                snapshot: {
                    binding: {
                        control: true,
                        alt: true,
                        shift: false,
                        key: 'KeyV'
                    },
                    status: 'active'
                }
            });
        });

        expect(screen.getByLabelText('Ctrl + Alt + V')).toBeTruthy();
        expect(screen.queryByText('shortcuts.tray.unset')).toBeNull();
        expect(screen.queryByText('shortcuts.tray.inactive')).toBeNull();

        act(() => {
            useTrayShortcutStore.setState({
                snapshot: { binding: null, status: 'unset' }
            });
        });

        expect(screen.getByText('shortcuts.tray.title')).toBeTruthy();
        expect(screen.getByText('shortcuts.tray.unset')).toBeTruthy();
        expect(screen.queryByLabelText('Ctrl + Alt + V')).toBeNull();
    });

    it('shows the configured keys when registration is unavailable', async () => {
        useTrayShortcutStore.setState({
            snapshot: {
                binding: { control: true, alt: false, shift: true, key: 'F8' },
                status: 'unavailable'
            }
        });
        render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />);

        expect(await screen.findByLabelText('Ctrl + Shift + F8')).toBeTruthy();
        expect(screen.getByText('shortcuts.tray.inactive')).toBeTruthy();
        expect(screen.queryByText('shortcuts.tray.unset')).toBeNull();
    });

    it('does not offer the Windows tray shortcut on macOS', async () => {
        useRuntimeStore.setState((state) => ({
            hostCapabilities: { ...state.hostCapabilities, platform: 'macos' }
        }));
        render(<KeyboardShortcutsDialog open onOpenChange={() => {}} />);

        expect(await screen.findByText('shortcuts.title')).toBeTruthy();
        expect(screen.queryByText('shortcuts.tray.title')).toBeNull();
        expect(screen.getByLabelText('Command + K')).toBeTruthy();
        expect(screen.getByLabelText('R')).toBeTruthy();
    });
});
