import {
    BellIcon,
    BotIcon,
    ImageIcon,
    type LucideIcon,
    MonitorIcon,
    PaletteIcon,
    PlugIcon,
    RectangleGogglesIcon,
    TerminalIcon,
    UsersIcon
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { SettingsAdvancedTab } from './components/settings-tabs/SettingsAdvancedTab';
import { SettingsAiTab } from './components/settings-tabs/SettingsAiTab';
import { SettingsIntegrationsTab } from './components/settings-tabs/SettingsIntegrationsTab';
import { SettingsInterfaceTab } from './components/settings-tabs/SettingsInterfaceTab';
import { SettingsMediaTab } from './components/settings-tabs/SettingsMediaTab';
import { SettingsNotificationsTab } from './components/settings-tabs/SettingsNotificationsTab';
import { SettingsSocialTab } from './components/settings-tabs/SettingsSocialTab';
import { SettingsSystemTab } from './components/settings-tabs/SettingsSystemTab';
import { SettingsVrTab } from './components/settings-tabs/SettingsVrTab';
import { SettingsDialogs } from './components/SettingsDialogs';
import {
    SettingsSearchInput,
    SettingsSearchResults
} from './components/SettingsSearch';
import {
    SettingsPageStateProvider,
    useSettingsPageSection
} from './SettingsPageStateContext';
import { useSettingsSearchActive } from './settingsSearchStore';

const SETTINGS_TAB_ICONS: Record<string, LucideIcon> = {
    system: MonitorIcon,
    interface: PaletteIcon,
    social: UsersIcon,
    ai: BotIcon,
    notifications: BellIcon,
    vr: RectangleGogglesIcon,
    media: ImageIcon,
    integrations: PlugIcon,
    advanced: TerminalIcon
};

export function SettingsPage() {
    return (
        <SettingsPageStateProvider>
            <SettingsPageContent />
        </SettingsPageStateProvider>
    );
}

function SettingsPageContent() {
    const { t } = useTranslation();
    const shell = useSettingsPageSection('shell');
    const searching = useSettingsSearchActive();
    const tabsContainerRef = useRef<HTMLDivElement>(null);

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t('view.settings.header')}</PageTitle>
                <PageDescription>{t('view.settings.subtitle')}</PageDescription>
            </PageHeader>
            <Tabs
                orientation="vertical"
                value={shell.activeSettingsTab}
                onValueChange={shell.setActiveSettingsTab}
                className="flex min-h-0 flex-1 gap-4"
            >
                <div className="flex w-44 shrink-0 flex-col self-start">
                    <SettingsSearchInput />
                    <TabsList className="h-fit w-full gap-0.5">
                        {shell.settingsTabs.map(([value, labelKey]) => {
                            const Icon = SETTINGS_TAB_ICONS[value];
                            return (
                                <TabsTrigger
                                    key={value}
                                    value={value}
                                    className="justify-start gap-2.5 px-3 py-1.5"
                                >
                                    {Icon ? <Icon /> : null}
                                    {t(labelKey)}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {searching ? (
                        <SettingsSearchResults
                            containerRef={tabsContainerRef}
                        />
                    ) : null}
                    <div
                        ref={tabsContainerRef}
                        className={
                            searching
                                ? 'hidden'
                                : 'flex min-h-0 min-w-0 flex-1 flex-col'
                        }
                    >
                        <SettingsSystemTab />
                        <SettingsInterfaceTab />
                        <SettingsSocialTab />
                        <SettingsNotificationsTab />
                        <SettingsVrTab />
                        <SettingsMediaTab />
                        <SettingsAiTab
                            active={shell.activeSettingsTab === 'ai'}
                        />
                        <SettingsIntegrationsTab />
                        <SettingsAdvancedTab />
                    </div>
                </div>
            </Tabs>
            <SettingsDialogs />
        </PageScaffold>
    );
}
