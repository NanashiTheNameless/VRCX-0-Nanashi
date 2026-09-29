// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    status: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appIntegrationApiStatus: mocks.status,
        appIntegrationApiSetEnabled: vi.fn(),
        appIntegrationApiSetPort: vi.fn(),
        appIntegrationApiSetAllowLanConnections: vi.fn(),
        appIntegrationApiRotateToken: vi.fn()
    }
}));

vi.mock('@/services/integrationApiService', () => ({
    subscribeIntegrationApiStatusRefresh: () => () => {}
}));

import { IntegrationApiSettingsGroup } from './IntegrationApiSettingsGroup';

describe('IntegrationApiSettingsGroup', () => {
    beforeEach(() => {
        mocks.status.mockReset();
        mocks.status.mockResolvedValue({
            enabled: false,
            allowLanConnections: false,
            port: 8799,
            activeConnections: 0,
            state: 'disabled',
            token: 'token',
            lastError: null
        });
    });

    afterEach(cleanup);

    it('keeps the current information type inside detailed settings', async () => {
        render(<IntegrationApiSettingsGroup />);

        await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());

        const roomInformation =
            'view.settings.integrations.integration_api.room_information';
        expect(screen.queryByText(roomInformation)).toBeNull();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.integrations.integration_api.information_types'
            })
        );

        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(screen.getByText(roomInformation)).toBeTruthy();
        expect(
            screen.getByText(
                'view.settings.integrations.integration_api.information_type_fixed'
            )
        ).toBeTruthy();
    });
});
