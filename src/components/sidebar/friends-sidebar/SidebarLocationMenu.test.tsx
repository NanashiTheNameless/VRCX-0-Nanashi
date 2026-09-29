// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/dialogService', () => ({
    openWorldDialog: vi.fn(),
    openGroupDialog: vi.fn()
}));
vi.mock('@/services/launchService', () => ({
    launchVrchat: vi.fn(),
    selfInviteToInstance: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@/services/toastService', () => ({ toast: { add: vi.fn() } }));
vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: vi.fn().mockResolvedValue(true)
}));

import { openWorldDialog } from '@/services/dialogService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { selfInviteToInstance } from '@/services/launchService';
import { isSidebarAutoHideInteractionBlocked } from '@/services/sidebarAutoHideService';
import { toast } from '@/services/toastService';
import { useShellStore } from '@/state/shellStore';

import { StaticSidebarLocation } from './FriendsSidebarLocation';

const location = 'wrld_test:123';

beforeEach(() => {
    vi.clearAllMocks();
    useShellStore.setState({ windowDisplayMode: 'normal' });
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function renderLocation() {
    render(
        <StaticSidebarLocation
            location={location}
            hint="Test room"
            link
            actionMenu
        />
    );
    return screen.getByRole('button', { name: /^Test room/ });
}

describe('sidebar location menus', () => {
    it('opens details on double click in sidebar mode', async () => {
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        await user.dblClick(renderLocation());
        expect(openWorldDialog).toHaveBeenCalledExactlyOnceWith({
            worldId: location,
            title: undefined
        });
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        expect(isSidebarAutoHideInteractionBlocked()).toBe(false);
        await user.click(screen.getByRole('button', { name: /^Test room/ }));
        expect(await screen.findAllByRole('menu')).toHaveLength(1);
        expect(openWorldDialog).toHaveBeenCalledOnce();
    });

    it.each(['left', 'right'])(
        'self invites from the %s-click menu without leaving sidebar mode',
        async (button) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            const user = userEvent.setup();
            const target = renderLocation();
            if (button === 'left') await user.click(target);
            else await user.pointer({ keys: '[MouseRight]', target });
            await user.click(
                await screen.findByRole('menuitem', {
                    name: 'dialog.launch.self_invite'
                })
            );
            expect(selfInviteToInstance).toHaveBeenCalledExactlyOnceWith(
                location,
                ''
            );
            expect(toast.add).toHaveBeenCalledWith({
                type: 'success',
                title: 'message.invite.self_sent'
            });
            expect(openWorldDialog).not.toHaveBeenCalled();
            expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
        }
    );

    it('reports a failed self invite', async () => {
        vi.mocked(selfInviteToInstance).mockRejectedValueOnce(
            new Error('Invite failed')
        );
        useShellStore.setState({ windowDisplayMode: 'sidebar' });
        const user = userEvent.setup();
        await user.click(renderLocation());
        await user.click(
            await screen.findByRole('menuitem', {
                name: 'dialog.launch.self_invite'
            })
        );
        expect(toast.add).toHaveBeenCalledWith({
            type: 'error',
            title: 'Invite failed'
        });
    });

    it('opens details directly in normal mode', async () => {
        const user = userEvent.setup();
        await user.click(renderLocation());
        expect(openWorldDialog).toHaveBeenCalledWith({
            worldId: location,
            title: undefined
        });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it.each(['click', 'Enter', ' '] as const)(
        'opens a menu in sidebar mode using %s',
        async (activation) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            const user = userEvent.setup();
            const trigger = renderLocation();
            if (activation === 'click') await user.click(trigger);
            else {
                trigger.focus();
                await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ');
            }
            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(openWorldDialog).not.toHaveBeenCalled();
            expect(useShellStore.getState().windowDisplayMode).toBe('sidebar');
            expect(isSidebarAutoHideInteractionBlocked()).toBe(true);
            await user.click(
                screen.getByRole('menuitem', {
                    name: 'common.actions.view_details'
                })
            );
            expect(openWorldDialog).toHaveBeenCalledWith({
                worldId: location,
                title: undefined
            });
        }
    );

    it.each(['normal', 'sidebar'] as const)(
        'opens the same actions on right click in %s mode',
        async (windowDisplayMode) => {
            useShellStore.setState({ windowDisplayMode });
            const user = userEvent.setup();
            await user.pointer({
                keys: '[MouseRight]',
                target: renderLocation()
            });
            expect(await screen.findAllByRole('menu')).toHaveLength(1);
            expect(openWorldDialog).not.toHaveBeenCalled();
            await user.click(
                screen.getByRole('menuitem', {
                    name: 'dialog.instance.action.open_in_game'
                })
            );
            expect(tryOpenLaunchLocation).toHaveBeenCalledWith(location, '');
            expect(useShellStore.getState().windowDisplayMode).toBe(
                windowDisplayMode
            );
        }
    );

    it.each(['normal', 'sidebar'] as const)(
        'leaves clicks and right clicks alone without an action menu in %s mode',
        async (windowDisplayMode) => {
            useShellStore.setState({ windowDisplayMode });
            const user = userEvent.setup();
            render(
                <StaticSidebarLocation
                    location={location}
                    hint="Test room"
                    link
                />
            );
            const target = screen.getByRole('button', { name: /^Test room/ });

            await user.pointer({ keys: '[MouseRight]', target });
            expect(screen.queryByRole('menu')).toBeNull();

            await user.click(target);
            expect(openWorldDialog).toHaveBeenCalledWith({
                worldId: location,
                title: undefined
            });
        }
    );

    it.each(['private', 'offline'])(
        'does not make %s locations interactive',
        (value) => {
            useShellStore.setState({ windowDisplayMode: 'sidebar' });
            render(<StaticSidebarLocation location={value} link />);
            expect(screen.queryByRole('button')).toBeNull();
        }
    );
});
