import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/services/toastService';
import { useCommunityThemeStore } from '@/state/communityThemeStore';

import { updateCommunityTheme } from './communityThemeUpdate';

const COMMUNITY_THEME_UPDATE_TOAST_ID = 'community-theme-update';

export function CommunityThemeUpdateToastHost(): null {
    const { t } = useTranslation();
    const activeThemeName = useCommunityThemeStore((state) =>
        state.enabled ? (state.installedTheme?.themeName ?? '') : ''
    );
    const activeUpdate = useCommunityThemeStore((state) => {
        const activeThemeId = state.enabled
            ? state.installedTheme?.themeId
            : undefined;
        return (
            state.updates.find((update) => update.themeId === activeThemeId) ??
            null
        );
    });
    const dismissedUpdateKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!activeUpdate) {
            toast.close(COMMUNITY_THEME_UPDATE_TOAST_ID);
            return;
        }
        const updateKey = `${activeUpdate.themeId}@${activeUpdate.latestVersion}`;
        if (dismissedUpdateKeyRef.current === updateKey) {
            return;
        }
        toast.add({
            id: COMMUNITY_THEME_UPDATE_TOAST_ID,
            type: 'info',
            title: t('view.community_themes.toast.update_available', {
                name: activeThemeName
            }),
            description: `${activeUpdate.installedVersion} → ${activeUpdate.latestVersion}`,
            timeout: 0,
            position: 'bottom-right',
            actionProps: {
                children: t('view.community_themes.action.update'),
                onClick: () => {
                    void updateCommunityTheme(activeUpdate.themeId, t);
                }
            },
            onClose: () => {
                dismissedUpdateKeyRef.current = updateKey;
            },
            data: { icon: null, closeButton: true }
        });
    }, [activeThemeName, activeUpdate, t]);

    return null;
}
