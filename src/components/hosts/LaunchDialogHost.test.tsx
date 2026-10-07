// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLocation } from '@/shared/utils/location';
import { useLaunchStore } from '@/state/launchStore';

import { LaunchDialogHost } from './LaunchDialogHost';

const mocks = vi.hoisted(() => ({
    copy: vi.fn(),
    resolve: vi.fn(),
    worldName: 'Idle Merchant 掛機商人（V0.3.1）'
}));

vi.mock('@/components/location/useLocationMetadata', () => ({
    useLocationMetadata: () => ({
        worldName: mocks.worldName,
        instanceName: '82121'
    })
}));
vi.mock('@/components/dialogs/InstanceInviteDialog', () => ({
    InstanceInviteDialog: () => null
}));
vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copy
}));
vi.mock('@/services/launchService', () => ({
    resolveLaunchDialogDetails: mocks.resolve,
    attachRunningVrchat: vi.fn(),
    launchVrchat: vi.fn(),
    selfInviteToInstance: vi.fn()
}));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: translate })
}));

function translate(key: string, values?: Record<string, string>) {
    if (key === 'accessibility.copy_value') {
        return `Copy ${values?.value}`;
    }
    return key;
}

const worldId = 'wrld_12345678-1234-1234-1234-1234567890ab';
const instanceId = '82121';
const location = `${worldId}:${instanceId}`;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.worldName = 'Idle Merchant 掛機商人（V0.3.1）';
    mocks.copy.mockResolvedValue(true);
    mocks.resolve.mockResolvedValue({
        tag: location,
        location,
        url: 'https://vrchat.com/home/launch',
        vrcUrl: '',
        shortName: 'token',
        launchToken: 'token',
        shortUrl: '',
        secureOrShortName: 'token',
        worldName: '',
        parsed: parseLocation(location)
    });
    useLaunchStore.getState().showLaunchDialog(location, 'token');
});
afterEach(() => {
    cleanup();
    useLaunchStore.getState().closeLaunchDialog();
});

describe('LaunchDialogHost instance sharing', () => {
    it('copies the plain VRChat launch link', async () => {
        const user = userEvent.setup();
        render(<LaunchDialogHost />);
        const button = screen.getByRole('button', {
            name: 'dialog.launch.share'
        });
        await waitFor(() =>
            expect((button as HTMLButtonElement).disabled).toBe(false)
        );
        await user.click(button);
        expect(mocks.copy.mock.calls[0][0]).toBe(
            'https://vrchat.com/home/launch'
        );
    });

    it('does not disable a valid share link while metadata is pending', async () => {
        mocks.worldName = '';
        render(<LaunchDialogHost />);
        const button = screen.getByRole('button', {
            name: 'dialog.launch.share'
        });
        await waitFor(() =>
            expect((button as HTMLButtonElement).disabled).toBe(false)
        );
    });
});

describe('LaunchDialogHost copy menu', () => {
    it('copies the raw instance id from the overflow menu', async () => {
        const user = userEvent.setup();
        render(<LaunchDialogHost />);
        await waitFor(() =>
            expect(
                (
                    screen.getByRole('button', {
                        name: 'dialog.launch.share'
                    }) as HTMLButtonElement
                ).disabled
            ).toBe(false)
        );
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.launch.more_copy_options'
            })
        );
        await user.click(
            await screen.findByRole('menuitem', {
                name: 'Copy dialog.launch.copy.instance_id'
            })
        );
        expect(mocks.copy.mock.calls[0][0]).toBe(location);
    });
});
