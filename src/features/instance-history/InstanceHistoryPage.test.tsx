// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

import type { InstanceHistoryEntryRow } from './instance-activity/instanceActivityTypes';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    deleteGameLogInstance: vi.fn(),
    getPreviousInstancesByUserId: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    runtimeState: {
        auth: {
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self User',
            currentUserEndpoint: 'https://api.vrchat.cloud/api/1'
        }
    },
    userFactsState: {
        usersByKey: {
            other: {
                id: 'usr_other',
                displayName: 'Other User',
                endpoint: 'https://api.vrchat.cloud/api/1'
            }
        }
    }
}));

vi.mock('@/services/toastService', () => ({
    toast: {
        add: (options: AppToastOptions) => {
            switch (options.type) {
                case 'error':
                    return mocks.toastError(options);
                case 'success':
                    return mocks.toastSuccess(options);
                default:
                    throw new Error('Unhandled toast type: ' + options.type);
            }
        }
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        deleteGameLogInstance: mocks.deleteGameLogInstance,
        getPreviousInstancesByUserId: mocks.getPreviousInstancesByUserId
    }
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: <T,>(
        selector: (state: { confirm: typeof mocks.confirm }) => T
    ) => selector({ confirm: mocks.confirm })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T,>(selector: (state: typeof mocks.runtimeState) => T) =>
        selector(mocks.runtimeState)
}));

vi.mock('@/state/userFactsStore', () => ({
    useUserFactsStore: <T,>(
        selector: (state: typeof mocks.userFactsState) => T
    ) => selector(mocks.userFactsState)
}));

vi.mock('@/components/layout/PageScaffold', () => ({
    PageBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PageScaffold: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    PageToolbar: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    PageToolbarRow: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    )
}));

vi.mock('@/components/layout/ToolbarControls', () => ({
    ToolbarActions: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    ToolbarRefreshButton: () => null,
    ToolbarSearch: ({ trailing }: { trailing?: ReactNode }) => (
        <div>{trailing}</div>
    ),
    toolbarSearchDateRangeTrigger: () => null,
    ToolbarTabs: () => null,
    ToolbarStatus: ({ children }: { children?: ReactNode }) => (
        <div data-testid="query-error">{children}</div>
    ),
    ToolbarViewMenu: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    ToolbarViews: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    )
}));

vi.mock('@/components/date-time-range-picker/DateTimeRangePicker', () => ({
    DateTimeRangePicker: ({
        onChange
    }: {
        onChange: (range: { from: Date; to: Date }) => void;
    }) => (
        <div>
            <button
                type="button"
                onClick={() => {
                    const now = Date.now();
                    onChange({
                        from: new Date(now - 4 * 24 * 60 * 60 * 1000),
                        to: new Date(now - 2 * 24 * 60 * 60 * 1000)
                    });
                }}
            >
                range one
            </button>
            <button
                type="button"
                onClick={() => {
                    const now = Date.now();
                    onChange({
                        from: new Date(now - 24 * 60 * 60 * 1000),
                        to: new Date(now + 24 * 60 * 60 * 1000)
                    });
                }}
            >
                range two
            </button>
        </div>
    )
}));

vi.mock('@/components/search/UserPickerRow', () => ({
    UserPickerRow: ({ option }: { option: { label: string } }) => (
        <span>{option.label}</span>
    )
}));

vi.mock(
    '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts',
    () => ({
        PreviousInstanceDetailsPanel: () => null
    })
);

vi.mock('./components/InstanceHistoryList', () => ({
    InstanceHistoryList: ({
        visibleRows,
        onDeleteRow,
        dateRangeControl
    }: {
        visibleRows: InstanceHistoryEntryRow[];
        onDeleteRow: (row: InstanceHistoryEntryRow) => void;
        dateRangeControl?: ReactNode;
    }) => (
        <div data-testid="history-list">
            {dateRangeControl}
            {visibleRows.map((row, index) => (
                <div key={String(row.id ?? index)}>
                    <span>{row.location}</span>
                    <button type="button" onClick={() => onDeleteRow(row)}>
                        delete {row.location}
                    </button>
                </div>
            ))}
        </div>
    )
}));

vi.mock('./components/InstanceActivityDateControls', () => ({
    InstanceActivityDateControls: () => null
}));

vi.mock('./components/InstanceActivitySettingsPopover', () => ({
    InstanceActivitySettingsPopover: () => null
}));

vi.mock('./instance-activity/useInstanceActivityData', () => ({
    useInstanceActivityData: () => ({
        availableDates: [],
        availableDatesError: '',
        availableDatesStatus: 'ready',
        dataDetail: '',
        dataStatus: 'ready',
        rawRows: [],
        worldDetailsById: {}
    })
}));

vi.mock('./instance-activity/useInstanceActivityRuntime', () => ({
    useInstanceActivityRuntime: () => ({
        favoriteIdSet: new Set<string>(),
        friendIdSet: new Set<string>(),
        hour12: false,
        resolvedTheme: 'dark'
    })
}));

vi.mock('./instance-activity/useInstanceActivitySettings', () => ({
    useInstanceActivitySettings: () => ({
        barWidth: 8,
        handleBarWidthCommit: vi.fn(),
        isChartCollapsed: true,
        isNoFriendInstanceVisible: true,
        isSoloInstanceVisible: true,
        setChartCollapsed: vi.fn(),
        setNoFriendInstanceVisible: vi.fn(),
        setSoloInstanceVisible: vi.fn()
    })
}));

vi.mock('./instance-activity/useInstanceActivityChartLifecycle', () => ({
    useInstanceActivityChartLifecycle: () => ({
        setMainChartElementRef: vi.fn()
    })
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        ...props
    }: ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button {...props}>{children}</button>
    )
}));

vi.mock('@/ui/shadcn/input', async () => {
    const { forwardRef } = await import('react');
    return {
        Input: forwardRef<
            HTMLInputElement,
            React.InputHTMLAttributes<HTMLInputElement>
        >((props, ref) => <input ref={ref} {...props} />)
    };
});

vi.mock('@/ui/shadcn/popover', () => ({
    Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PopoverContent: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    PopoverTrigger: ({ render }: { render: ReactNode }) => render
}));

vi.mock('@/ui/shadcn/resizable', () => ({
    ResizableHandle: () => null,
    ResizablePanel: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    ),
    ResizablePanelGroup: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    )
}));

vi.mock('@/ui/shadcn/scroll-area', () => ({
    ScrollArea: ({ children }: { children?: ReactNode }) => (
        <div>{children}</div>
    )
}));

vi.mock('@/ui/shadcn/spinner', () => ({ Spinner: () => null }));

import { InstanceHistoryPage } from './InstanceHistoryPage';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: Error) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function row(
    location: string,
    events: number[] = [1],
    createdAt = new Date(Date.now() - 60_000).toISOString()
): InstanceHistoryEntryRow {
    return {
        id: location,
        createdAt,
        location,
        events
    };
}

function renderPage() {
    return render(
        <MemoryRouter>
            <InstanceHistoryPage />
        </MemoryRouter>
    );
}

describe('InstanceHistoryPage', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        mocks.confirm.mockReset();
        mocks.deleteGameLogInstance.mockReset();
        mocks.getPreviousInstancesByUserId.mockReset();
        mocks.toastError.mockReset();
        mocks.toastSuccess.mockReset();
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'ok' });
        mocks.deleteGameLogInstance.mockResolvedValue(undefined);
        mocks.getPreviousInstancesByUserId.mockResolvedValue([]);
    });

    it('ignores stale failures after a user switch and stale successes after a range switch', async () => {
        const user = userEvent.setup();
        const selfRequest = deferred<InstanceHistoryEntryRow[]>();
        const otherRequest = deferred<InstanceHistoryEntryRow[]>();
        const firstRangeRequest = deferred<InstanceHistoryEntryRow[]>();
        const secondRangeRequest = deferred<InstanceHistoryEntryRow[]>();
        mocks.getPreviousInstancesByUserId
            .mockImplementationOnce(() => selfRequest.promise)
            .mockImplementationOnce(() => otherRequest.promise)
            .mockImplementationOnce(() => firstRangeRequest.promise)
            .mockImplementationOnce(() => secondRangeRequest.promise);

        renderPage();
        await waitFor(() =>
            expect(mocks.getPreviousInstancesByUserId).toHaveBeenCalledTimes(1)
        );

        await user.click(screen.getByRole('button', { name: 'Other User' }));
        await waitFor(() =>
            expect(mocks.getPreviousInstancesByUserId).toHaveBeenCalledTimes(2)
        );
        await act(async () => {
            otherRequest.resolve([row('wrld_other:1')]);
            selfRequest.reject(new Error('stale self failure'));
        });

        expect(await screen.findByText('wrld_other:1')).not.toBeNull();
        expect(screen.queryByText('stale self failure')).toBeNull();

        await user.click(screen.getByRole('button', { name: 'range one' }));
        await waitFor(() =>
            expect(mocks.getPreviousInstancesByUserId).toHaveBeenCalledTimes(3)
        );
        await user.click(screen.getByRole('button', { name: 'range two' }));
        await waitFor(() =>
            expect(mocks.getPreviousInstancesByUserId).toHaveBeenCalledTimes(4)
        );
        await act(async () => {
            secondRangeRequest.resolve([row('wrld_newest:1')]);
            firstRangeRequest.resolve([
                row(
                    'wrld_stale:1',
                    [1],
                    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
                )
            ]);
        });

        expect(await screen.findByText('wrld_newest:1')).not.toBeNull();
        expect(screen.queryByText('wrld_stale:1')).toBeNull();
    });

    it('confirms before deleting and requires event ids', async () => {
        const user = userEvent.setup();
        const rowWithoutEvents = row('wrld_without_events:1', []);
        mocks.getPreviousInstancesByUserId.mockResolvedValue([
            rowWithoutEvents
        ]);

        renderPage();
        await user.click(
            await screen.findByRole('button', {
                name: 'delete wrld_without_events:1'
            })
        );

        await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
        expect(mocks.deleteGameLogInstance).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                title: 'dialog.previous_instances.error.this_user_instance_row_cannot_be_deleted_without_event_ids'
            })
        );
        expect(screen.getByText('wrld_without_events:1')).not.toBeNull();
    });

    it('removes a row only after confirmation and successful persistence', async () => {
        const user = userEvent.setup();
        const confirmation = deferred<{ ok: boolean; reason: string }>();
        mocks.confirm.mockReturnValue(confirmation.promise);
        mocks.getPreviousInstancesByUserId.mockResolvedValue([
            row('wrld_delete:1', [41, 42])
        ]);

        renderPage();
        await user.click(
            await screen.findByRole('button', {
                name: 'delete wrld_delete:1'
            })
        );

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.deleteGameLogInstance).not.toHaveBeenCalled();
        await act(async () => {
            confirmation.resolve({ ok: true, reason: 'ok' });
        });

        await waitFor(() =>
            expect(mocks.deleteGameLogInstance).toHaveBeenCalledWith({
                location: 'wrld_delete:1',
                events: [41, 42]
            })
        );
        await waitFor(() =>
            expect(screen.queryByText('wrld_delete:1')).toBeNull()
        );
        expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });

    it('keeps the row when persistence fails', async () => {
        const user = userEvent.setup();
        mocks.getPreviousInstancesByUserId.mockResolvedValue([
            row('wrld_keep:1', [9])
        ]);
        mocks.deleteGameLogInstance.mockRejectedValue(
            new Error('delete failed')
        );

        renderPage();
        await user.click(
            await screen.findByRole('button', { name: 'delete wrld_keep:1' })
        );

        await waitFor(() =>
            expect(mocks.toastError).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'delete failed'
                })
            )
        );
        expect(screen.getByText('wrld_keep:1')).not.toBeNull();
    });
});
