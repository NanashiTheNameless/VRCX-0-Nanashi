// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/dialogs/AvatarDialogContent', () => ({
    AvatarDialogContent: () => null
}));

vi.mock('@/components/dialogs/GroupDialogContent', () => ({
    GroupDialogContent: () => null
}));

vi.mock('@/components/dialogs/UserDialogContent', () => ({
    UserDialogContent: () => null
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
        | null
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        open,
        onOpenChange
    }: PropsWithChildren<{
        open: boolean;
        onOpenChange: (open: boolean, details: OpenChangeDetails) => void;
    }>) => {
        dialogMock.onOpenChange = onOpenChange;
        return open ? <div>{children}</div> : null;
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
});
