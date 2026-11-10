// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_DEFAULT_VALUES } from '../../settingsFieldState';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';

const K = 'view.settings.appearance.appearance.reduced_motion_and_blur';

function renderCard(reducedMotionAndBlur: boolean) {
    const onChange = vi.fn<(value: boolean) => void>();
    render(
        <SettingsInterfaceAppearanceCard
            locale="en"
            prefs={{
                appFontFamily: 'default',
                appCjkFontPack: 'none',
                tableDensity: 'standard',
                dataTableStriped: false,
                ctrlWheelZoom: false,
                accessibleStatusIndicators: false,
                reducedMotionAndBlur
            }}
            zoomInput="100"
            hideFontControls
            onLanguageChange={() => {}}
            onFontFamilyChange={() => {}}
            onCjkFontPackChange={() => {}}
            onZoomInputChange={() => {}}
            onZoomBlur={() => {}}
            onCtrlWheelZoomChange={() => {}}
            onTableDensityChange={() => {}}
            onDataTableStripedChange={() => {}}
            onAccessibleStatusIndicatorsChange={() => {}}
            onReducedMotionAndBlurChange={onChange}
        />
    );
    return onChange;
}

function reduceEffectsSwitch() {
    const toggle = screen
        .getByText(K)
        .closest('[data-slot="field"]')
        ?.querySelector('[role="switch"]');
    if (!toggle) {
        throw new Error('Reduce Effects switch not found');
    }
    return toggle;
}

describe('Reduce Effects', () => {
    afterEach(cleanup);

    it('is off by default', () => {
        expect(SETTINGS_DEFAULT_VALUES.reducedMotionAndBlur).toBe(false);
    });

    it('asks before turning effects off, and Cancel keeps them on', () => {
        const onChange = renderCard(false);
        fireEvent.click(reduceEffectsSwitch());
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(`${K}_confirm_title`)).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: `${K}_confirm_cancel` })
        );
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.queryByText(`${K}_confirm_title`)).toBeNull();
    });

    it('turns effects off only from the not recommended button', () => {
        const onChange = renderCard(false);
        fireEvent.click(reduceEffectsSwitch());
        fireEvent.click(
            screen.getByRole('button', { name: `${K}_confirm_action` })
        );
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('turns effects back on without asking', () => {
        const onChange = renderCard(true);
        fireEvent.click(reduceEffectsSwitch());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
        expect(screen.queryByText(`${K}_confirm_title`)).toBeNull();
    });
});
