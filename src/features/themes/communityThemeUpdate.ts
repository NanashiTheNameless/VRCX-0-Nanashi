import type { TFunction } from 'i18next';

import { updateInstalledCommunityTheme } from '@/services/communityThemeService';
import { toast } from '@/services/toastService';

export async function updateCommunityTheme(
    themeId: string,
    t: TFunction
): Promise<void> {
    try {
        const theme = await updateInstalledCommunityTheme(themeId);
        toast.add({
            type: 'success',
            title: t('view.community_themes.toast.theme_updated', {
                version: theme.version
            })
        });
    } catch (updateError) {
        toast.add({
            type: 'error',
            title:
                updateError instanceof Error
                    ? updateError.message
                    : t('view.community_themes.toast.update_failed')
        });
    }
}
