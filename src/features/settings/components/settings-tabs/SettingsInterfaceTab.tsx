import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsCustomLanguagesCard } from './SettingsCustomLanguagesCard';
import { SettingsInterfaceAppearanceCard } from './SettingsInterfaceAppearanceCard';
import { SettingsInterfaceDisplayCards } from './SettingsInterfaceDisplayCards';
import { SettingsInterfaceThemesCard } from './SettingsInterfaceThemesCard';
import { SettingsInterfaceUserColorsCard } from './SettingsInterfaceUserColorsCard';

export function SettingsInterfaceTab() {
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            appFontFamily: state.appFontFamily,
            appCjkFontPack: state.appCjkFontPack,
            customFontFamily: state.customFontFamily,
            customFontPrimary: state.customFontPrimary,
            customFontSecondary: state.customFontSecondary,
            customFontOverride: state.customFontOverride,
            notificationLayout: state.notificationLayout,
            notificationIconDot: state.notificationIconDot,
            taskbarIconDot: state.taskbarIconDot,
            tableDensity: state.tableDensity,
            dataTableStriped: state.dataTableStriped,
            reducedMotionAndBlur: state.reducedMotionAndBlur,
            accessibleStatusIndicators: state.accessibleStatusIndicators,
            showInstanceIdInLocation: state.showInstanceIdInLocation,
            isAgeGatedInstancesVisible: state.isAgeGatedInstancesVisible,
            hideNicknames: state.hideNicknames,
            showNewDashboardButton: state.showNewDashboardButton,
            dtHour12: state.dtHour12,
            dtIsoFormat: state.dtIsoFormat,
            weekStartsOn: state.weekStartsOn,
            feedTimeDisplayMode: state.feedTimeDisplayMode,
            randomUserColours: state.randomUserColours,
            trustColor: state.trustColor
        }))
    );
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    const isWindowsHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'windows'
    );
    const {
        locale,
        zoomInput,
        onLanguageChange,
        onFontFamilyChange,
        onCjkFontPackChange,
        onZoomInputChange,
        onZoomBlur,
        notificationLayoutOptions,
        onNotificationLayoutChange,
        onNotificationIconDotChange,
        onTaskbarIconDotChange,
        onTableDensityChange,
        onDataTableStripedChange,
        onAccessibleStatusIndicatorsChange,
        onReducedMotionAndBlurChange,
        onShowInstanceIdInLocationChange,
        onAgeGatedInstancesVisibleChange,
        onHideNicknamesChange,
        onShowNewDashboardButtonChange,
        onOpenTablePageSizes,
        onOpenTableLimits,
        onHour12Change,
        onIsoFormatChange,
        onWeekStartsOnChange,
        onFeedTimeDisplayModeChange,
        onRandomUserColoursChange,
        onResetTrustColors,
        onSaveTrustColor,
        onTrustColorDraftChange
    } = settingsInterface;
    return (
        <SettingsTabContent value="interface">
            <SettingsInterfaceAppearanceCard
                locale={locale}
                prefs={prefs}
                zoomInput={zoomInput}
                hideFontControls={isMacHost}
                showTaskbarIconDot={isWindowsHost}
                onLanguageChange={onLanguageChange}
                onFontFamilyChange={onFontFamilyChange}
                onCjkFontPackChange={onCjkFontPackChange}
                onZoomInputChange={onZoomInputChange}
                onZoomBlur={onZoomBlur}
                notificationLayoutOptions={notificationLayoutOptions}
                onNotificationLayoutChange={onNotificationLayoutChange}
                onNotificationIconDotChange={onNotificationIconDotChange}
                onTaskbarIconDotChange={onTaskbarIconDotChange}
                onTableDensityChange={onTableDensityChange}
                onDataTableStripedChange={onDataTableStripedChange}
                onAccessibleStatusIndicatorsChange={
                    onAccessibleStatusIndicatorsChange
                }
                onReducedMotionAndBlurChange={onReducedMotionAndBlurChange}
            />
            <SettingsCustomLanguagesCard />
            <SettingsInterfaceThemesCard />
            <SettingsInterfaceDisplayCards
                prefs={prefs}
                onShowInstanceIdInLocationChange={
                    onShowInstanceIdInLocationChange
                }
                onAgeGatedInstancesVisibleChange={
                    onAgeGatedInstancesVisibleChange
                }
                onHideNicknamesChange={onHideNicknamesChange}
                onShowNewDashboardButtonChange={onShowNewDashboardButtonChange}
                onOpenTablePageSizes={onOpenTablePageSizes}
                onOpenTableLimits={onOpenTableLimits}
                onHour12Change={onHour12Change}
                onIsoFormatChange={onIsoFormatChange}
                onWeekStartsOnChange={onWeekStartsOnChange}
                onFeedTimeDisplayModeChange={onFeedTimeDisplayModeChange}
            />
            <SettingsInterfaceUserColorsCard
                prefs={prefs}
                onRandomUserColoursChange={onRandomUserColoursChange}
                onResetTrustColors={onResetTrustColors}
                onSaveTrustColor={onSaveTrustColor}
                onTrustColorDraftChange={onTrustColorDraftChange}
            />
        </SettingsTabContent>
    );
}
