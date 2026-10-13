// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRuntimeStore } from '@/state/runtimeStore';

import {
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsNameModeOptions,
    notificationTtsOptions
} from '../settingsOptions';
import type { SettingsPageStateSections } from '../settingsPageStateSections';
import { useSettingsNotificationsTabState } from './useSettingsNotificationsTabState';

const captured = vi.hoisted(() => ({
    notifications: undefined as unknown
}));

vi.mock('../SettingsPageStateContext', () => ({
    useSettingsPageSection: () => captured.notifications
}));

type NotificationsSectionState = SettingsPageStateSections['notifications'];

function createNotificationsSectionState(): NotificationsSectionState {
    return {
        desktopToastOptions,
        notificationTtsOptions,
        notificationTtsNameModeOptions,
        ttsVoices: [],
        notificationTtsTestVisible: false,
        notificationTtsTest: '',
        setDesktopNotificationsDialogOpen: vi.fn(),
        setDesktopWidgetDialogOpen: vi.fn(),
        setTtsNotificationsDialogOpen: vi.fn(),
        saveStringPreference: vi.fn(),
        saveBoolPreference: vi.fn(),
        savePreferenceValue: vi.fn(),
        setIntConfigPreference: vi.fn(),
        saveNotificationTtsMode: vi.fn(),
        saveNotificationTtsVoice: vi.fn(),
        setNotificationTtsTestVisible: vi.fn(),
        setNotificationTtsTest: vi.fn(),
        speakNotificationTts: vi.fn(),
        notificationLayoutOptions,
        setWebhookNotificationsDialogOpen: vi.fn(),
        onNotificationLayoutChange: vi.fn(),
        onNotificationIconDotChange: vi.fn(),
        onTaskbarIconDotChange: vi.fn(),
        onFriendLogNotificationDotChange: vi.fn()
    };
}

function setDesktopWidgetSupported(supported: boolean) {
    useRuntimeStore.getState().setDesktopWidget({
        supported,
        enabled: false,
        pinned: false,
        clickThrough: false
    });
}

describe('useSettingsNotificationsTabState', () => {
    beforeEach(() => {
        captured.notifications = createNotificationsSectionState();
        setDesktopWidgetSupported(false);
    });

    it('offers desktop overlay settings only where the platform supports the window', () => {
        const { result } = renderHook(() => useSettingsNotificationsTabState());
        expect(result.current.showDesktopWidget).toBe(false);

        act(() => setDesktopWidgetSupported(true));

        expect(result.current.showDesktopWidget).toBe(true);
    });

    it('saves the desktop overlay background opacity as a whole percentage within 0-100', () => {
        const notifications = createNotificationsSectionState();
        captured.notifications = notifications;
        const { result } = renderHook(() => useSettingsNotificationsTabState());

        result.current.onDesktopWidgetOpacityChange(72.4);
        expect(notifications.savePreferenceValue).toHaveBeenLastCalledWith(
            'desktopWidgetOpacity',
            72,
            expect.any(Function)
        );
        const commit = vi.mocked(notifications.savePreferenceValue).mock
            .calls[0][2];
        commit();
        expect(notifications.setIntConfigPreference).toHaveBeenLastCalledWith(
            'desktopWidgetOpacity',
            72,
            { min: 0, max: 100, fallback: 55 }
        );

        result.current.onDesktopWidgetOpacityChange(180);
        expect(notifications.savePreferenceValue).toHaveBeenLastCalledWith(
            'desktopWidgetOpacity',
            100,
            expect.any(Function)
        );

        result.current.onDesktopWidgetOpacityChange(-20);
        expect(notifications.savePreferenceValue).toHaveBeenLastCalledWith(
            'desktopWidgetOpacity',
            0,
            expect.any(Function)
        );
    });

    it('saves which end of the desktop overlay new activity appears at', () => {
        const notifications = createNotificationsSectionState();
        captured.notifications = notifications;
        const { result } = renderHook(() => useSettingsNotificationsTabState());

        result.current.onDesktopWidgetOrderChange('bottom');
        expect(notifications.saveBoolPreference).toHaveBeenLastCalledWith(
            'desktopWidgetNewestOnTop',
            'desktopWidgetNewestOnTop',
            false
        );

        result.current.onDesktopWidgetOrderChange('top');
        expect(notifications.saveBoolPreference).toHaveBeenLastCalledWith(
            'desktopWidgetNewestOnTop',
            'desktopWidgetNewestOnTop',
            true
        );
    });

    it('opens the desktop overlay activity filters from its settings', () => {
        const notifications = createNotificationsSectionState();
        captured.notifications = notifications;
        const { result } = renderHook(() => useSettingsNotificationsTabState());

        result.current.onOpenDesktopWidgetFiltersDialog();

        expect(notifications.setDesktopWidgetDialogOpen).toHaveBeenCalledWith(
            true
        );
        expect(
            notifications.setDesktopNotificationsDialogOpen
        ).not.toHaveBeenCalled();
    });
});
