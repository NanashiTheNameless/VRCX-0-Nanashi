// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

afterEach(cleanup);

const mocks = vi.hoisted(() => ({
    launchVrchat: vi.fn(),
    tryOpenLaunchLocation: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const labels: Record<string, string> = {
                'dialog.launch.tile.vr': 'VR',
                'dialog.launch.tile.desktop': 'Desktop',
                'dialog.instance.action.open_in_game': 'Open In-Game'
            };
            return labels[key] || key;
        }
    })
}));

vi.mock('@/ui/shadcn/context-menu', () => ({
    ContextMenuGroup: ({ children, ...props }: React.ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
    ),
    ContextMenuItem: ({
        children,
        ...props
    }: React.ComponentProps<'button'>) => (
        <button type="button" {...props}>
            {children}
        </button>
    )
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.error(options);
                case 'success':
                    return mocks.success(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/services/launchService', () => ({
    launchVrchat: mocks.launchVrchat
}));

vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: mocks.tryOpenLaunchLocation
}));

import { LaunchModeContextMenuGroup } from './LaunchModeContextMenuGroup';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('LaunchModeContextMenuGroup', () => {
    it('maps the VR and Desktop choices to the existing launch service flag', async () => {
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled={false}
                errorMessage="Failed"
                location="wrld_test:123"
                shortName="token"
            />
        );

        fireEvent.click(getByRole('button', { name: 'VR' }));
        fireEvent.click(getByRole('button', { name: 'Desktop' }));

        await waitFor(() => {
            expect(mocks.launchVrchat).toHaveBeenNthCalledWith(
                1,
                'wrld_test:123',
                'token',
                false
            );
            expect(mocks.launchVrchat).toHaveBeenNthCalledWith(
                2,
                'wrld_test:123',
                'token',
                true
            );
        });
    });

    it('disables both launch modes together', () => {
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled
                errorMessage="Failed"
                location="wrld_test:123"
            />
        );

        expect(
            getByRole('button', { name: 'VR' }).hasAttribute('disabled')
        ).toBe(true);
        expect(
            getByRole('button', { name: 'Desktop' }).hasAttribute('disabled')
        ).toBe(true);
    });

    it.each([
        { location: 'wrld_test:123', closed: true },
        { location: 'private', closed: false },
        { location: 'offline', closed: false },
        { location: 'traveling', closed: false },
        { location: 'wrld_test', closed: false }
    ])(
        'does not open an unavailable in-game target: %o',
        ({ location, closed }) => {
            const { getByRole } = render(
                <LaunchModeContextMenuGroup
                    disabled={false}
                    instanceClosed={closed}
                    errorMessage="Failed"
                    location={location}
                />
            );

            const openInGame = getByRole('button', { name: 'Open In-Game' });
            expect(openInGame.hasAttribute('disabled')).toBe(true);
            fireEvent.click(openInGame);
            expect(mocks.tryOpenLaunchLocation).not.toHaveBeenCalled();
        }
    );

    it('attempts to open a concrete invite-only location without requiring game detection or launch permission', async () => {
        mocks.tryOpenLaunchLocation.mockResolvedValue(true);
        const location = 'wrld_test:123~private(usr_host)';
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled
                errorMessage="Failed"
                location={location}
                shortName="token"
            />
        );

        const openInGame = getByRole('button', { name: 'Open In-Game' });
        expect(openInGame.hasAttribute('disabled')).toBe(false);
        fireEvent.click(openInGame);

        await waitFor(() =>
            expect(mocks.success).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'success',
                    title: 'dialog.instance.success.vrchat_launch_request_sent'
                })
            )
        );
        expect(mocks.tryOpenLaunchLocation).toHaveBeenCalledExactlyOnceWith(
            location,
            'token'
        );
        expect(mocks.launchVrchat).not.toHaveBeenCalled();
    });

    it('reports unsuccessful in-game opens without falling back to launching', async () => {
        mocks.tryOpenLaunchLocation.mockResolvedValue(false);
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled={false}
                errorMessage="Failed"
                location="wrld_test:123"
            />
        );
        fireEvent.click(getByRole('button', { name: 'Open In-Game' }));

        await waitFor(() =>
            expect(mocks.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'dialog.instance.error.unable_to_open_this_instance_in_vrchat'
                })
            )
        );
        expect(mocks.success).not.toHaveBeenCalled();
        expect(mocks.launchVrchat).not.toHaveBeenCalled();
    });

    it('reports an in-game open error through the existing toast path', async () => {
        mocks.tryOpenLaunchLocation.mockRejectedValue(
            new Error('Connection failed')
        );
        const { getByRole } = render(
            <LaunchModeContextMenuGroup
                disabled={false}
                errorMessage="Failed"
                location="wrld_test:123"
            />
        );
        fireEvent.click(getByRole('button', { name: 'Open In-Game' }));

        await waitFor(() =>
            expect(mocks.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'Connection failed'
                })
            )
        );
        expect(mocks.success).not.toHaveBeenCalled();
    });
});
