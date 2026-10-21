// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLocation } from '@/shared/utils/location';
import { useLaunchStore } from '@/state/launchStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { LaunchDialogHost } from './LaunchDialogHost';

const mocks = vi.hoisted(() => ({
    copy: vi.fn(),
    resolve: vi.fn(),
    launch: vi.fn(),
    selfInvite: vi.fn(),
    selectAvatar: vi.fn(),
    getMyAvatars: vi.fn(),
    toast: vi.fn(),
    worldName: 'Idle Merchant 掛機商人（V0.3.1）',
    configGetString: vi
        .fn()
        .mockResolvedValue('https://vrcx.namelessnanashi.dev')
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
vi.mock('@/repositories/configRepository', () => ({
    default: { getString: mocks.configGetString }
}));
vi.mock('@/services/launchService', () => ({
    resolveLaunchDialogDetails: mocks.resolve,
    attachRunningVrchat: vi.fn(),
    launchVrchat: mocks.launch,
    selfInviteToInstance: mocks.selfInvite
}));
vi.mock('@/services/avatarSelectionService', () => ({
    selectAvatar: mocks.selectAvatar
}));
vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toast }
}));
vi.mock('@/repositories/myAvatarRepository', () => ({
    default: { getMyAvatars: mocks.getMyAvatars }
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
    it('offers a RemoteSync instance relay link', async () => {
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
                name: 'Copy dialog.launch.copy.vrcx_link'
            })
        );
        expect(mocks.copy.mock.calls[0][0]).toContain(
            'https://vrcx.namelessnanashi.dev/open/instance/'
        );
    });

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

describe('LaunchDialogHost avatar switch', () => {
    beforeEach(() => {
        mocks.selectAvatar.mockResolvedValue({ applied: true });
        mocks.getMyAvatars.mockResolvedValue([
            { id: 'avtr_current', name: 'Daily' },
            { id: 'avtr_safe', name: 'Public Safe' }
        ]);
        useRuntimeStore.setState((state) => ({
            auth: {
                ...state.auth,
                currentUserId: 'usr_me',
                currentUserSnapshot: {
                    id: 'usr_me',
                    currentAvatar: 'avtr_current',
                    currentAvatarName: 'Daily'
                }
            }
        }));
    });

    async function renderReady() {
        const user = userEvent.setup();
        render(
            <QueryClientProvider client={new QueryClient()}>
                <LaunchDialogHost />
            </QueryClientProvider>
        );
        const selfInvite = screen.getByRole('button', {
            name: 'dialog.launch.label.self_invite'
        });
        await waitFor(() =>
            expect((selfInvite as HTMLButtonElement).disabled).toBe(false)
        );
        return { user, selfInvite };
    }

    async function chooseAvatar(
        user: ReturnType<typeof userEvent.setup>,
        name: RegExp
    ) {
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.launch.avatar_switch.toggle'
            })
        );
        const trigger = await screen.findByRole('combobox', {
            name: 'dialog.launch.avatar_switch.toggle'
        });
        await waitFor(() => expect(trigger.textContent).toContain('Daily'));
        await user.click(trigger);
        await user.click(await screen.findByRole('option', { name }));
        await waitFor(() => expect(trigger.textContent).toMatch(name));
    }

    it('explains the API delay when hovering the hint icon', async () => {
        const { user } = await renderReady();
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.launch.avatar_switch.toggle'
            })
        );
        await user.hover(
            await screen.findByTestId('launch-avatar-switch-hint')
        );
        expect(
            await screen.findByText('dialog.launch.avatar_switch.hint')
        ).toBeTruthy();
    });

    it('selects the chosen avatar before self-inviting', async () => {
        const { user, selfInvite } = await renderReady();
        await chooseAvatar(user, /Public Safe/);
        await user.click(selfInvite);
        await waitFor(() => expect(mocks.selfInvite).toHaveBeenCalled());
        expect(mocks.selectAvatar).toHaveBeenCalledWith('avtr_safe');
        expect(mocks.selectAvatar.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.selfInvite.mock.invocationCallOrder[0]
        );
        expect(mocks.toast).toHaveBeenCalledWith({
            type: 'success',
            title: 'dialog.avatar.success.avatar_selected'
        });
    });

    it('keeps the current avatar when the switch is collapsed', async () => {
        const { user } = await renderReady();
        await chooseAvatar(user, /Public Safe/);
        await user.click(
            screen.getByRole('button', {
                name: 'dialog.launch.avatar_switch.toggle'
            })
        );
        await user.click(
            screen.getByRole('button', { name: 'dialog.launch.tile.vr' })
        );
        await waitFor(() => expect(mocks.launch).toHaveBeenCalled());
        expect(mocks.selectAvatar).not.toHaveBeenCalled();
    });

    it('does not select an avatar when the current one stays chosen', async () => {
        const { user, selfInvite } = await renderReady();
        await chooseAvatar(user, /Daily/);
        await user.click(selfInvite);
        await waitFor(() => expect(mocks.selfInvite).toHaveBeenCalled());
        expect(mocks.selectAvatar).not.toHaveBeenCalled();
    });

    it('still joins when the selected snapshot is superseded', async () => {
        mocks.selectAvatar.mockResolvedValue({ applied: false });
        const { user, selfInvite } = await renderReady();
        await chooseAvatar(user, /Public Safe/);
        await user.click(selfInvite);
        await waitFor(() => expect(mocks.selfInvite).toHaveBeenCalled());
    });

    it('pauses joining when the server does not respond in time', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            mocks.selectAvatar.mockReturnValue(new Promise(() => {}));
            const { user } = await renderReady();
            await chooseAvatar(user, /Public Safe/);
            await user.click(
                screen.getByRole('button', { name: 'dialog.launch.tile.vr' })
            );
            await vi.advanceTimersByTimeAsync(3000);
            await waitFor(() =>
                expect(mocks.toast).toHaveBeenCalledWith(
                    expect.objectContaining({
                        title: 'dialog.launch.avatar_switch.timeout'
                    })
                )
            );
            expect(mocks.launch).not.toHaveBeenCalled();
            expect(useLaunchStore.getState().launchDialog.open).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
