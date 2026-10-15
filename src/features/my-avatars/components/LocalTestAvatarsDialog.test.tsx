// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type {
    ButtonHTMLAttributes,
    InputHTMLAttributes,
    PropsWithChildren,
    ReactNode
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalTestAvatarOutput } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    delete: vi.fn(),
    confirm: vi.fn(),
    toastAdd: vi.fn(),
    vrchatPathAvailable: true
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appLocalTestAvatarsList: mocks.list,
        appLocalTestAvatarDelete: mocks.delete
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ confirm: mocks.confirm }) }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(
        selector: (state: {
            hostCapabilities: { vrchatPathDiscovery: { available: boolean } };
        }) => T
    ) =>
        selector({
            hostCapabilities: {
                vrchatPathDiscovery: { available: mocks.vrchatPathAvailable }
            }
        })
}));

vi.mock('@/lib/dateTime', () => ({
    formatDateFilter: (value: string) => `date:${value}`
}));

vi.mock('@/components/layout/ToolbarControls', () => ({
    ToolbarIconButton: ({
        label,
        onClick
    }: {
        label: string;
        onClick: () => void;
    }) => (
        <button type="button" onClick={onClick}>
            {label}
        </button>
    )
}));

vi.mock('@/components/layout/PageScaffold', () => ({
    EmptyState: ({
        title,
        description
    }: {
        title?: ReactNode;
        description?: ReactNode;
    }) => (
        <div>
            {title}
            {description}
        </div>
    ),
    LoadingState: () => <div>loading</div>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: PropsWithChildren<
        ButtonHTMLAttributes<HTMLButtonElement> & {
            variant?: unknown;
            size?: unknown;
        }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    )
}));

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => <span>spinner</span>
}));

import { LocalTestAvatarsButton } from './LocalTestAvatarsDialog';

function avatar(name: string): LocalTestAvatarOutput {
    return {
        fileName: `${name}.vrca`,
        name,
        size: 2048,
        modifiedAt: '2026-10-14T12:00:00.000Z'
    };
}

async function openDialog() {
    render(<LocalTestAvatarsButton />);
    fireEvent.click(
        screen.getByRole('button', {
            name: 'view.my_avatars.action.open_local_test_avatars'
        })
    );
    await screen.findByText(/Milfy/);
}

describe('LocalTestAvatarsButton', () => {
    beforeEach(() => {
        mocks.vrchatPathAvailable = true;
        mocks.list.mockResolvedValue([avatar('Milfy'), avatar('Mafuyu')]);
        mocks.delete.mockResolvedValue(null);
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'ok' });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('lists local test avatars and filters them by name', async () => {
        await openDialog();

        expect(screen.getByText('Mafuyu')).toBeTruthy();
        expect(
            screen.getAllByText('2.0 KB · date:2026-10-14T12:00:00.000Z')
        ).toHaveLength(2);

        fireEvent.change(screen.getByPlaceholderText('common.actions.search'), {
            target: { value: 'milf' }
        });

        expect(screen.getByText('Milfy')).toBeTruthy();
        expect(screen.queryByText('Mafuyu')).toBeNull();
    });

    it('deletes a confirmed avatar by file name and drops it from the list', async () => {
        await openDialog();

        fireEvent.click(
            screen.getAllByRole('button', { name: 'common.actions.delete' })[0]
        );

        await waitFor(() => {
            expect(screen.queryByText('Milfy')).toBeNull();
        });
        expect(mocks.delete).toHaveBeenCalledWith('Milfy.vrca');
        expect(screen.getByText('Mafuyu')).toBeTruthy();
    });

    it('keeps the avatar when the deletion is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancel' });
        await openDialog();

        fireEvent.click(
            screen.getAllByRole('button', { name: 'common.actions.delete' })[0]
        );

        await waitFor(() => {
            expect(mocks.confirm).toHaveBeenCalled();
        });
        expect(mocks.delete).not.toHaveBeenCalled();
        expect(screen.getByText('Milfy')).toBeTruthy();
    });

    it('reports a failed deletion and keeps the avatar listed', async () => {
        mocks.delete.mockRejectedValue('The process cannot access the file');
        await openDialog();

        fireEvent.click(
            screen.getAllByRole('button', { name: 'common.actions.delete' })[0]
        );

        await waitFor(() => {
            expect(mocks.toastAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'view.my_avatars.toast.failed_to_delete_local_test_avatar'
                })
            );
        });
        expect(screen.getByText('Milfy')).toBeTruthy();
    });

    it('is hidden when VRChat paths cannot be discovered', () => {
        mocks.vrchatPathAvailable = false;

        render(<LocalTestAvatarsButton />);

        expect(screen.queryByRole('button')).toBeNull();
    });
});
