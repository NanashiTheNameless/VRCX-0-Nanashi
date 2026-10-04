import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    copyTextToClipboard: vi.fn(),
    openShellExternalLink: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openExternalLink: mocks.openShellExternalLink
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));

vi.mock('@/services/i18nService', () => ({
    default: { t: (key: string) => key }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

import { openExternalLink } from './entityMediaService';

const RELEASES_URL = 'https://github.com/Map1en/VRCX-0/releases';

describe('openExternalLink', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens the link without a toast when the system opener succeeds', async () => {
        mocks.openShellExternalLink.mockResolvedValue(null);

        await openExternalLink(RELEASES_URL);

        expect(mocks.openShellExternalLink).toHaveBeenCalledWith(RELEASES_URL);
        expect(mocks.toastAdd).not.toHaveBeenCalled();
    });

    it('shows a persistent error with a copy action when the system opener fails', async () => {
        mocks.openShellExternalLink.mockRejectedValue(
            new Error('open link: xdg-open failed')
        );

        await openExternalLink(RELEASES_URL);

        expect(mocks.toastAdd).toHaveBeenCalledTimes(1);
        const options = mocks.toastAdd.mock.calls[0][0] as AppToastOptions;
        expect(options).toMatchObject({
            type: 'error',
            title: 'message.external_link.open_failed',
            description: RELEASES_URL,
            timeout: 0
        });

        options.actionProps?.onClick?.({} as never);
        expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(RELEASES_URL, {
            successMessage: 'message.external_link.copied'
        });
    });
});
