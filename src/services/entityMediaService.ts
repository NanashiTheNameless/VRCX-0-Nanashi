import { copyTextToClipboard } from '@/services/clipboardService';
import { directAccessParse } from '@/services/directAccessService';
import i18n from '@/services/i18nService';
import { openExternalLink as openShellExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import {
    convertFileUrlToImageUrl as convertFileUrlToImageUrlWithEndpoint,
    getNameColour,
    userImage as userImageWithEndpoint,
    type ImageUser
} from '@/shared/utils/entityMedia';
import { useRuntimeStore } from '@/state/runtimeStore';

export function convertFileUrlToImageUrl(
    url: string | null | undefined,
    resolution: string | number = 128,
    endpointDomain: string | null = null
) {
    return convertFileUrlToImageUrlWithEndpoint(
        url,
        resolution,
        endpointDomain || useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

export function userImage(
    user: ImageUser | null | undefined,
    resolution: string | number = 128
) {
    return userImageWithEndpoint(
        user,
        resolution,
        useRuntimeStore.getState().auth.currentUserEndpoint
    );
}

type OpenExternalLinkOptions = {
    directAccess?: boolean;
};

export { getNameColour };

export async function openExternalLink(
    link: unknown,
    options: OpenExternalLinkOptions = {}
) {
    if (!link) {
        return;
    }

    const normalizedLink = String(link);
    if (options.directAccess) {
        try {
            if (await directAccessParse(normalizedLink)) {
                return;
            }
        } catch (error) {
            console.warn('Failed to resolve direct access target:', error);
        }
    }

    try {
        await openShellExternalLink(normalizedLink);
    } catch {
        toast.add({
            type: 'error',
            title: i18n.t('message.external_link.open_failed'),
            description: normalizedLink,
            timeout: 0,
            actionProps: {
                children: i18n.t('message.external_link.copy_link'),
                onClick: () => {
                    void copyTextToClipboard(normalizedLink, {
                        successMessage: i18n.t('message.external_link.copied')
                    });
                }
            },
            data: { closeButton: true }
        });
    }
}
