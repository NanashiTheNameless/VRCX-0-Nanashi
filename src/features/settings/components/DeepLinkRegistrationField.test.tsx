// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeepLinkRegistrationField } from './DeepLinkRegistrationField';

const labels: Record<string, string> = {
    'view.settings.advanced.advanced_ui.behavior.deep_link_registration':
        'Open VRCX-0 links',
    'view.settings.advanced.advanced_ui.behavior.deep_link_repair': 'Fix'
};

const commandMocks = vi.hoisted(() => ({
    appDeepLinkRegistrationStatus: vi.fn(),
    appDeepLinkRegistrationRepair: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: commandMocks
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string) => labels[key] ?? key
    })
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

function renderTab() {
    return render(<DeepLinkRegistrationField />);
}

describe('DeepLinkRegistrationField', () => {
    afterEach(cleanup);

    beforeEach(() => {
        commandMocks.appDeepLinkRegistrationStatus
            .mockReset()
            .mockResolvedValue(null);
        commandMocks.appDeepLinkRegistrationRepair
            .mockReset()
            .mockResolvedValue(true);
    });

    it('shows the cross-platform Fix action for registration errors', async () => {
        commandMocks.appDeepLinkRegistrationStatus.mockRejectedValueOnce(
            new Error('registry value is malformed')
        );

        renderTab();

        expect(
            await screen.findByRole('button', {
                name: 'Fix'
            })
        ).not.toBeNull();
        expect(screen.getByText('Open VRCX-0 links')).not.toBeNull();
    });

    it('keeps the repair action hidden on unsupported platforms', async () => {
        renderTab();

        await vi.waitFor(() => {
            expect(
                commandMocks.appDeepLinkRegistrationStatus
            ).toHaveBeenCalledOnce();
        });
        expect(
            screen.queryByRole('button', {
                name: 'Fix'
            })
        ).toBeNull();
    });
});
