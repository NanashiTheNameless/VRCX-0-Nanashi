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
    PropsWithChildren
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    createShareCollection: vi.fn(),
    copyTextToClipboard: vi.fn(),
    openExternalLink: vi.fn(),
    toastError: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appShareCollectionCreate: mocks.createShareCollection
    }
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: mocks.openExternalLink
}));

vi.mock('@/ui/shadcn/alert', () => ({
    Alert: ({ children }: PropsWithChildren) => <div>{children}</div>,
    AlertDescription: ({ children }: PropsWithChildren) => <div>{children}</div>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        ...props
    }: PropsWithChildren<
        ButtonHTMLAttributes<HTMLButtonElement> & { variant?: unknown }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({
        children,
        open,
        onOpenChange
    }: PropsWithChildren<{
        open: boolean;
        onOpenChange(open: boolean): void;
    }>) =>
        open ? (
            <div>
                <button
                    aria-label="close"
                    data-testid="dialog-close-signal"
                    onClick={() => onOpenChange(false)}
                />
                {children}
            </div>
        ) : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/field', () => ({
    Field: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldDescription: ({ children }: PropsWithChildren) => (
        <span>{children}</span>
    ),
    FieldGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    FieldLabel: ({
        children,
        htmlFor
    }: PropsWithChildren<{ htmlFor?: string }>) => (
        <label htmlFor={htmlFor}>{children}</label>
    ),
    FieldTitle: ({ children }: PropsWithChildren) => <span>{children}</span>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
        <input {...props} />
    )
}));

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => null
}));

vi.mock('@/ui/shadcn/switch', () => ({
    Switch: ({
        checked,
        onCheckedChange,
        ...props
    }: InputHTMLAttributes<HTMLInputElement> & {
        onCheckedChange(value: boolean): void;
    }) => (
        <input
            {...props}
            type="checkbox"
            checked={checked}
            onChange={(event) => onCheckedChange(event.currentTarget.checked)}
        />
    )
}));

import { FavoriteShareCollectionDialog } from './FavoriteShareCollectionDialog';

const WORLD_A = 'wrld_12345678-1234-1234-1234-1234567890ab';
const WORLD_B = 'wrld_abcdefab-cdef-abcd-efab-cdefabcdefab';

function deferred<T>() {
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((_resolve, rejectPromise) => {
        reject = rejectPromise;
    });
    return { promise, reject };
}

function renderDialog(onOpenChange = vi.fn(), onOpenManage = vi.fn()) {
    render(
        <FavoriteShareCollectionDialog
            open
            onOpenChange={onOpenChange}
            onOpenManage={onOpenManage}
            remoteWorldDetailsStatus="ready"
            group={{
                key: 'group_1',
                source: 'local',
                label: 'Weekend worlds'
            }}
            items={[
                {
                    key: 'world-a',
                    id: WORLD_A,
                    kind: 'world',
                    source: 'local',
                    title: 'World A'
                },
                {
                    key: 'invalid',
                    id: 'legacy-world',
                    kind: 'world',
                    source: 'local',
                    title: 'Legacy world'
                },
                {
                    key: 'world-b',
                    id: WORLD_B,
                    kind: 'world',
                    source: 'local',
                    title: 'World B'
                }
            ]}
        />
    );
    return { onOpenChange, onOpenManage };
}

function switchById(id: string): HTMLInputElement {
    const element = document.querySelector(`#${id}`);
    expect(element).toBeInstanceOf(HTMLInputElement);
    return element as HTMLInputElement;
}

describe('FavoriteShareCollectionDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(cleanup);

    it('submits the edited sharing options and reports skipped worlds', async () => {
        mocks.createShareCollection.mockResolvedValue({
            id: 'share_1',
            url: 'https://example.test/c/share_1',
            worldCount: 1,
            skippedWorlds: [{ worldId: WORLD_B, name: 'World B' }]
        });
        const { onOpenChange, onOpenManage } = renderDialog();

        const titleInput = screen.getByLabelText(
            'view.favorite.share_collection.label.title'
        );
        expect((titleInput as HTMLInputElement).value).toBe('Weekend worlds');
        fireEvent.change(
            screen.getByLabelText('view.favorite.share_collection.label.title'),
            { target: { value: 'Shared picks' } }
        );
        fireEvent.click(switchById('favorite-share-collection-listed'));
        fireEvent.click(switchById('favorite-share-collection-include-notes'));
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.share'
            })
        );

        await waitFor(() => {
            expect(mocks.createShareCollection).toHaveBeenCalledWith({
                title: 'Shared picks',
                listed: true,
                includeNotes: true,
                worldIds: [WORLD_A, WORLD_B]
            });
        });
        await screen.findByDisplayValue('https://example.test/c/share_1');
        screen.getByText(
            'view.favorite.share_collection.success.skipped:{"count":2}'
        );
        screen.getByText(/Legacy world/);
        screen.getByText(/World B/);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.copy_share_url'
            })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.open_share_page'
            })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.open_manage'
            })
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.done'
            })
        );

        expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
            'https://example.test/c/share_1',
            expect.any(Object)
        );
        expect(mocks.openExternalLink).toHaveBeenCalledWith(
            'https://example.test/c/share_1'
        );
        expect(onOpenManage).toHaveBeenCalledOnce();
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('keeps the dialog open while sharing and allows retry after failure', async () => {
        const pending = deferred<never>();
        mocks.createShareCollection.mockReturnValueOnce(pending.promise);
        const { onOpenChange } = renderDialog();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.share'
            })
        );
        fireEvent.click(screen.getByTestId('dialog-close-signal'));
        expect(onOpenChange).not.toHaveBeenCalled();

        pending.reject(new Error('network unavailable'));
        await waitFor(() => {
            expect(mocks.toastError).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: expect.stringContaining('network unavailable')
                })
            );
        });

        mocks.createShareCollection.mockResolvedValueOnce({
            id: 'share_2',
            url: 'https://example.test/c/share_2',
            worldCount: 2,
            skippedWorlds: []
        });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.favorite.share_collection.action.share'
            })
        );
        await waitFor(() => {
            expect(mocks.createShareCollection).toHaveBeenCalledTimes(2);
        });
        await screen.findByDisplayValue('https://example.test/c/share_2');
    });

    it('waits for remote world details before sharing the collection', async () => {
        mocks.createShareCollection.mockResolvedValue({
            id: 'share_remote',
            url: 'https://example.test/c/share_remote',
            worldCount: 1,
            skippedWorlds: []
        });
        const props = {
            open: true,
            onOpenChange: vi.fn(),
            onOpenManage: vi.fn(),
            group: {
                key: 'group_1',
                source: 'remote' as const,
                label: 'VRChat favorites'
            },
            items: [
                {
                    key: 'world-a',
                    id: WORLD_A,
                    kind: 'world' as const,
                    source: 'remote' as const,
                    title: 'World A'
                }
            ]
        };
        const { rerender } = render(
            <FavoriteShareCollectionDialog
                {...props}
                remoteWorldDetailsStatus="idle"
            />
        );

        const shareButton = screen.getByRole('button', {
            name: 'view.favorite.share_collection.action.share'
        }) as HTMLButtonElement;
        expect(shareButton.disabled).toBe(true);
        fireEvent.click(shareButton);
        expect(mocks.createShareCollection).not.toHaveBeenCalled();

        rerender(
            <FavoriteShareCollectionDialog
                {...props}
                remoteWorldDetailsStatus="running"
            />
        );
        expect(shareButton.disabled).toBe(true);

        rerender(
            <FavoriteShareCollectionDialog
                {...props}
                group={{ ...props.group, source: 'local' }}
                remoteWorldDetailsStatus="running"
            />
        );
        expect(shareButton.disabled).toBe(false);

        rerender(
            <FavoriteShareCollectionDialog
                {...props}
                remoteWorldDetailsStatus="ready"
            />
        );
        expect(shareButton.disabled).toBe(false);
        fireEvent.click(shareButton);
        await waitFor(() => {
            expect(mocks.createShareCollection).toHaveBeenCalledOnce();
        });
    });
});
