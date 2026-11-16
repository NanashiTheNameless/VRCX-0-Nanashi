import {
    ChevronDownIcon,
    ExternalLinkIcon,
    SearchIcon,
    SettingsIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    canSearchInApp,
    codeSearchLinkUrl,
    DEFAULT_CODE_SEARCH_QUERY,
    loadCodeSearchSettings,
    OFFICIAL_CODE_SEARCH_QUERY,
    type CodeSearchSettings
} from '@/services/codeSearchService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { getSettingDeepLinkPath } from '@/shared/constants/settingsManifest';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';

import { CodeSearchDialog } from './CodeSearchDialog';

const T = 'view.tools.inventory';

/**
 * Searches for VRChat codes with the engines chosen in Settings > Integrations
 * > Code Search. With none chosen it only offers to open that setting.
 */
export function FindRedeemCodesMenu() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [settings, setSettings] = useState<CodeSearchSettings | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    const officialUrl = settings
        ? codeSearchLinkUrl(settings, OFFICIAL_CODE_SEARCH_QUERY)
        : null;
    const webUrl = settings
        ? codeSearchLinkUrl(settings, DEFAULT_CODE_SEARCH_QUERY)
        : null;
    const inApp = settings ? canSearchInApp(settings) : false;

    return (
        <>
            <DropdownMenu
                onOpenChange={(open) => {
                    if (open) {
                        void loadCodeSearchSettings()
                            .then(setSettings)
                            .catch(() => {});
                    }
                }}
            >
                <DropdownMenuTrigger
                    render={
                        <Button type="button" variant="outline" size="sm">
                            <SearchIcon data-icon="inline-start" />
                            {t(`${T}.find_codes`)}
                            <ChevronDownIcon data-icon="inline-end" />
                        </Button>
                    }
                />
                <DropdownMenuContent align="end" className="w-72">
                    {officialUrl && webUrl ? (
                        <>
                            <DropdownMenuItem
                                onClick={() =>
                                    void openExternalLink(officialUrl)
                                }
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                {t(`${T}.find_codes_official`)}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => void openExternalLink(webUrl)}
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                {t(`${T}.find_codes_web`)}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                    {inApp ? (
                        <DropdownMenuItem onClick={() => setDialogOpen(true)}>
                            <SearchIcon data-icon="inline-start" />
                            {t(`${T}.find_codes_in_app`)}
                        </DropdownMenuItem>
                    ) : null}
                    {(officialUrl && webUrl) || inApp ? (
                        <DropdownMenuSeparator />
                    ) : null}
                    <DropdownMenuItem
                        onClick={() =>
                            navigate(
                                getSettingDeepLinkPath(
                                    'integrations.code-search.link-engine'
                                )
                            )
                        }
                    >
                        <SettingsIcon data-icon="inline-start" />
                        {t(`${T}.find_codes_settings`)}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {settings && inApp ? (
                <CodeSearchDialog
                    open={dialogOpen}
                    settings={settings}
                    onOpenChange={setDialogOpen}
                />
            ) : null}
        </>
    );
}
