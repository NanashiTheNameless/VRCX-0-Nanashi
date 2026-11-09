// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import {
    type ComponentProps,
    type PropsWithChildren,
    useEffect,
    useState
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/dialogs/AvatarDialogContent', () => ({
    AvatarDialogContent: () => null
}));

vi.mock('@/components/dialogs/GroupDialogContent', () => ({
    GroupDialogContent: () => null
}));

vi.mock('@/components/dialogs/UserDialogContent', () => ({
    UserDialogContent: ({ userId }: { userId: string }) => (
        <div data-testid="user-profile">{userId}</div>
    )
}));

vi.mock('@/components/dialogs/WorldDialogContent', () => ({
    WorldDialogContent: () => null
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: ComponentProps<'button'> & {
        variant?: string;
        size?: string;
    }) => <button {...props}>{children}</button>
}));

type OpenChangeDetails = { reason: string; cancel: () => void };

const dialogMock = vi.hoisted(() => ({
    onOpenChange: null as
        | ((open: boolean, details: OpenChangeDetails) => void)
        | null,
    onOpenChangeComplete: null as ((open: boolean) => void) | null
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        open,
        onOpenChange,
        onOpenChangeComplete
    }: PropsWithChildren<{
        open: boolean;
        onOpenChange: (open: boolean, details: OpenChangeDetails) => void;
        onOpenChangeComplete?: (open: boolean) => void;
    }>) => {
        const [mounted, setMounted] = useState(open);
        useEffect(() => {
            if (open) {
                setMounted(true);
            }
        }, [open]);
        dialogMock.onOpenChange = onOpenChange;
        dialogMock.onOpenChangeComplete = onOpenChangeComplete ?? null;
        return mounted ? (
            <div
                data-testid="dialog-root"
                data-state={open ? 'open' : 'closed'}
            >
                {!open ? (
                    <button
                        onClick={() => {
                            setMounted(false);
                            onOpenChangeComplete?.(false);
                        }}
                    >
                        finish close animation
                    </button>
                ) : null}
                {children}
            </div>
        ) : null;
    },
    DialogContent: ({
        children,
        showCloseButton: _showCloseButton,
        ...props
    }: PropsWithChildren<
        ComponentProps<'section'> & {
            showCloseButton?: boolean;
        }
    >) => <section {...props}>{children}</section>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

import { FORK_DEVELOPER_USER_ID } from '@/shared/constants/user';
import { useDialogStore } from '@/state/dialogStore';

import { DialogHost } from './DialogHost';

describe('DialogHost breadcrumb navigation', () => {
    beforeEach(() => {
        useDialogStore.getState().clearDialogState();
        useDialogStore.getState().setDialogTrail(
            {
                kind: 'world',
                entityId: 'wrld_b',
                title: 'World B'
            },
            [
                {
                    key: 'user:usr_a',
                    kind: 'user',
                    entityId: 'usr_a',
                    title: 'User A'
                },
                {
                    key: 'world:wrld_b',
                    kind: 'world',
                    entityId: 'wrld_b',
                    title: 'World B'
                }
            ]
        );
    });

    afterEach(() => {
        cleanup();
        useDialogStore.getState().clearDialogState();
    });

    it('returns to the previous breadcrumb and hides the button at the root', () => {
        render(<DialogHost />);

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.back' })
        );

        expect(useDialogStore.getState().activeDialog).toMatchObject({
            kind: 'user',
            entityId: 'usr_a'
        });
        expect(useDialogStore.getState().breadcrumbs).toHaveLength(1);
        expect(
            screen.queryByRole('button', { name: 'common.actions.back' })
        ).toBeNull();
    });

    it('steps back one breadcrumb on Escape instead of closing the trail', () => {
        render(<DialogHost />);
        const cancel = vi.fn();

        act(() => {
            dialogMock.onOpenChange?.(false, { reason: 'escape-key', cancel });
        });

        expect(cancel).toHaveBeenCalled();
        expect(useDialogStore.getState().activeDialog).toMatchObject({
            kind: 'user',
            entityId: 'usr_a'
        });
        expect(useDialogStore.getState().breadcrumbs).toHaveLength(1);

        act(() => {
            dialogMock.onOpenChange?.(false, {
                reason: 'escape-key',
                cancel: vi.fn()
            });
        });

        expect(useDialogStore.getState().activeDialog).toBeNull();
    });

    it('closes the whole trail on outside press', () => {
        render(<DialogHost />);

        act(() => {
            dialogMock.onOpenChange?.(false, {
                reason: 'outside-press',
                cancel: vi.fn()
            });
        });

        expect(useDialogStore.getState().activeDialog).toBeNull();
        expect(useDialogStore.getState().breadcrumbs).toEqual([]);
    });

    it('keeps the profile, theme, and breadcrumbs until the close animation finishes', async () => {
        useDialogStore.getState().setDialog({
            kind: 'user',
            entityId: FORK_DEVELOPER_USER_ID,
            title: 'Maintainer'
        });
        render(<DialogHost />);
        const profile = await screen.findByTestId('user-profile');
        const popup = profile.closest('section');

        act(() => {
            dialogMock.onOpenChange?.(false, {
                reason: 'outside-press',
                cancel: vi.fn()
            });
        });

        expect(useDialogStore.getState().activeDialog).toBeNull();
        expect(useDialogStore.getState().breadcrumbs).toEqual([]);
        expect(
            screen.getByTestId('dialog-root').getAttribute('data-state')
        ).toBe('closed');
        expect(screen.getByTestId('user-profile')).toBe(profile);
        expect(profile.textContent).toBe(FORK_DEVELOPER_USER_ID);
        expect(popup?.classList.contains('fork-maintainer-dialog')).toBe(true);
        expect(
            screen.getByRole('heading', { name: 'Maintainer' })
        ).toBeTruthy();
        expect(
            screen.getByRole('button', { name: 'common.actions.back' })
        ).toBeTruthy();
        expect(screen.queryAllByText('Unsupported dialog type.')).toEqual([]);

        fireEvent.click(
            screen.getByRole('button', { name: 'finish close animation' })
        );

        expect(screen.queryByTestId('user-profile')).toBeNull();
        expect(screen.queryByTestId('dialog-root')).toBeNull();
    });

    it('preserves a newly opened profile if an earlier close completes', async () => {
        render(<DialogHost />);
        const finishEarlierClose = dialogMock.onOpenChangeComplete;

        act(() => useDialogStore.getState().closeDialog());
        act(() =>
            useDialogStore.getState().setDialogTrail(
                {
                    kind: 'user',
                    entityId: 'usr_new',
                    title: 'New user'
                },
                []
            )
        );
        await screen.findByTestId('user-profile');
        act(() => finishEarlierClose?.(false));

        expect(screen.getByTestId('user-profile').textContent).toBe('usr_new');
        expect(useDialogStore.getState().activeDialog?.entityId).toBe(
            'usr_new'
        );
        expect(screen.getByRole('heading', { name: 'New user' })).toBeTruthy();

        act(() => useDialogStore.getState().closeDialog());
        expect(screen.getByTestId('user-profile').textContent).toBe('usr_new');
        expect(screen.queryAllByText('Unsupported dialog type.')).toEqual([]);
    });

    it('still shows the fallback for an unsupported open dialog', () => {
        useDialogStore.getState().setDialogTrail(
            {
                kind: 'unknown',
                entityId: 'unknown',
                title: 'Unknown'
            },
            []
        );
        render(<DialogHost />);

        expect(screen.getAllByText('Unsupported dialog type.')).toHaveLength(2);
    });
});
