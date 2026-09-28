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
    SettingsPageStateProvider,
    useSettingsPageSection
} from './SettingsPageStateContext';

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
                <TabsList className="h-fit w-44 shrink-0 gap-0.5 self-start">
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
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <SettingsSystemTab />
                    <SettingsInterfaceTab />
                    <SettingsSocialTab />
                    <SettingsNotificationsTab />
                    <SettingsVrTab />
                    <SettingsMediaTab />
                    <SettingsAiTab active={shell.activeSettingsTab === 'ai'} />
                    <SettingsIntegrationsTab />
                    <SettingsAdvancedTab />
                </div>
            </Tabs>
            <SettingsDialogs />
        </PageScaffold>
    );
}
