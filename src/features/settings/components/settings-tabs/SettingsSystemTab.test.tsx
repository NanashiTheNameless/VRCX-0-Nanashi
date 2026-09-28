import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

type ChildrenProps = {
    children?: ReactNode;
};

vi.mock('@/ui/shadcn/badge', () => ({
    Badge: ({ children }: ChildrenProps) => <span>{children}</span>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        disabled
    }: ChildrenProps & { disabled?: boolean }) => (
        <button disabled={disabled}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({ disabled }: { disabled?: boolean }) => (
        <input type="checkbox" aria-label="Setting" disabled={disabled} />
    )
}));

vi.mock('../SettingsField', () => ({
    Field: ({
        children,
        description,
        label,
        disabled
    }: ChildrenProps & {
        description?: ReactNode;
        label?: ReactNode;
        disabled?: boolean;
    }) => (
        <section
            data-setting={typeof label === 'string' ? label : undefined}
            data-disabled={disabled || undefined}
        >
            <span>{label}</span>
            <span>{description}</span>
            {children}
        </section>
    )
}));

vi.mock('../KeepSystemAwakeSetting', () => ({
    KeepSystemAwakeSetting: () => null
}));
vi.mock('../SettingsViewParts', () => ({
    SettingsTabContent: ({ children }: ChildrenProps) => <div>{children}</div>
}));

import { SettingsSystemTabContent as SettingsSystemTab } from './SettingsSystemTab';

function noop() {}

const handlers = {
    onAutoInstallUpdatesOnStartupChange: noop,
    onAutoLoginDelayEnabledChange: noop,
    onBackgroundModeDelayEnabledChange: noop,
    onBackgroundModeEnabledChange: noop,
    onCloseToTrayChange: noop,
    onPostUpdateChangelogToastChange: noop,
    onPromptAutoLoginDelaySeconds: noop,
    onPromptBackgroundModeDelayMinutes: noop,
    onProxyEnabledChange: noop,
    onProxySettings: noop,
    onStartAsMinimizedChange: noop,
    onStartAtWindowsStartupChange: noop,
    onSystemWindowFrameChange: noop
};

describe('SettingsSystemTab updater policy', () => {
    it.each([false, true])(
        'allows configuring background mode and delay without close-to-tray or a shortcut (background mode: %s)',
        (backgroundModeEnabled) => {
            const html = renderToStaticMarkup(
                <SettingsSystemTab
                    hostPlatform="windows"
                    isCloseToTray={false}
                    backgroundModeEnabled={backgroundModeEnabled}
                    backgroundModeDelayEnabled
                    backgroundModeDelayMinutes={60}
                    {...handlers}
                />
            );
            const sections =
                html.match(/<section\b[^>]*>[\s\S]*?<\/section>/g) ?? [];
            for (const setting of [
                'background_mode',
                'background_mode_delay',
                'background_mode_delay_button'
            ]) {
                const section = sections.find((candidate) =>
                    candidate.startsWith(
                        `<section data-setting="view.settings.general.application.${setting}"`
                    )
                );
                expect(section).toBeDefined();
                expect(section).not.toContain('disabled');
            }
        }
    );

    it('shows global tray shortcut settings only on Windows', () => {
        for (const hostPlatform of ['windows', 'macos', 'linux'] as const) {
            const html = renderToStaticMarkup(
                <SettingsSystemTab hostPlatform={hostPlatform} {...handlers} />
            );
            expect(html.includes('shortcuts.tray.title')).toBe(
                hostPlatform === 'windows'
            );
        }
    });

    it('shows a disabled status badge instead of an update control', () => {
        const html = renderToStaticMarkup(
            <SettingsSystemTab
                updateCheckDisabled
                hostPlatform="windows"
                {...handlers}
            />
        );

        expect(html).toContain(
            'view.settings.general.application.check_for_updates_and_update'
        );
        expect(html).toContain(
            'view.settings.general.application.update_check_disabled'
        );
        expect(html).toContain(
            'view.settings.general.application.update_check_disabled_build_description'
        );
        expect(html).not.toContain(
            'view.settings.general.application.auto_install_updates_on_startup'
        );
    });
});

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));
