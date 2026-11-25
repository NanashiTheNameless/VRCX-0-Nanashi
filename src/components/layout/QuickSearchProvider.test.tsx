// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    currentUserId: 'usr_first',
    getClipboardText: vi.fn(() => Promise.resolve('')),
    directAccessParse: vi.fn(() => Promise.resolve(true)),
    toastAdd: vi.fn(() => 'loading-toast'),
    toastClose: vi.fn(),
    dialogMounted: vi.fn(),
    dialogUnmounted: vi.fn(),
    t: (key: string) => key
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            auth: { currentUserId: string; currentUserEndpoint: string };
        }) => unknown
    ) =>
        selector({
            auth: {
                currentUserId: mocks.currentUserId,
                currentUserEndpoint: 'https://vrchat.com'
            }
        })
}));
vi.mock('@/services/shellIntegrationService', () => ({
    getClipboardText: mocks.getClipboardText
}));
vi.mock('@/services/directAccessService', () => ({
    directAccessParse: mocks.directAccessParse
}));
vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd, close: mocks.toastClose }
}));
vi.mock('@/components/sidebar/QuickSearchDialog', () => ({
    QuickSearchDialog: ({
        open,
        query,
        retryInput,
        clipboardSession,
        onQueryChange,
        onOpenChange,
        onOpenChangeComplete,
        onDirectAccess
    }: {
        open: boolean;
        query: string;
        retryInput: string;
        clipboardSession: number;
        onQueryChange: (query: string) => void;
        onOpenChange: (open: boolean) => void;
        onOpenChangeComplete: (open: boolean) => void;
        onDirectAccess: (input: string) => void;
    }) => {
        useEffect(() => {
            mocks.dialogMounted();
            return mocks.dialogUnmounted;
        }, []);
        return (
            <div
                data-testid="dialog-root"
                data-open={open}
                data-retry={retryInput}
                data-clipboard-session={clipboardSession}
            >
                {open ? (
                    <div role="dialog">
                        <span>{query || 'empty search'}</span>
                        <input
                            aria-label="query"
                            value={query}
                            onChange={(event) =>
                                onQueryChange(event.target.value)
                            }
                        />
                        <button onClick={() => onDirectAccess(query)}>
                            retry
                        </button>
                        <button onClick={() => onOpenChange(false)}>
                            close
                        </button>
                    </div>
                ) : (
                    <span data-testid="closing-query">{query}</span>
                )}
                <button onClick={() => onOpenChangeComplete(false)}>
                    finish closing
                </button>
            </div>
        );
    }
}));

import { QuickSearchProvider } from './QuickSearchProvider';
import { useQuickSearchActions } from './useQuickSearchActions';

function MenuControl() {
    const actions = useQuickSearchActions();
    return <button onClick={actions.openQuickSearch}>menu search</button>;
}

function Controls() {
    const actions = useQuickSearchActions();
    return (
        <>
            <button onClick={actions.openQuickSearch}>search</button>
            <button onClick={actions.openDirectAccessFromClipboard}>
                clipboard
            </button>
        </>
    );
}

function Harness({ enabled = true }: { enabled?: boolean }) {
    return (
        <QuickSearchProvider enabled={enabled}>
            <Controls />
            <MenuControl />
        </QuickSearchProvider>
    );
}

describe('QuickSearchProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.currentUserId = 'usr_first';
        mocks.toastAdd.mockReset();
        mocks.toastAdd.mockReturnValue('loading-toast');
        mocks.toastClose.mockReset();
        mocks.getClipboardText.mockResolvedValue('usr_clipboard');
        mocks.directAccessParse.mockResolvedValue(true);
    });

    afterEach(cleanup);

    it('opens the clipboard directly without displaying a search dialog', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        await waitFor(() =>
            expect(mocks.directAccessParse).toHaveBeenCalledExactlyOnceWith(
                'usr_clipboard'
            )
        );
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mocks.toastClose).toHaveBeenCalledWith('loading-toast');
    });

    it.each(['unrecognised', 'network error'])(
        'keeps the failed input in quick search after %s and supports retry',
        async (failure) => {
            if (failure === 'network error') {
                mocks.directAccessParse.mockRejectedValueOnce(
                    new Error('offline')
                );
            } else {
                mocks.directAccessParse.mockResolvedValueOnce(false);
            }
            render(<Harness />);
            fireEvent.click(screen.getByText('clipboard'));
            await screen.findByText('usr_clipboard');
            expect(mocks.toastAdd).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'error',
                    title: 'prompt.direct_access_omni.description_failed'
                })
            );

            fireEvent.click(screen.getByText('retry'));
            await waitFor(() =>
                expect(mocks.directAccessParse).toHaveBeenCalledTimes(2)
            );
            expect(mocks.getClipboardText).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('dialog')).toBeNull();
        }
    );

    it('opens empty quick search for an empty clipboard', async () => {
        mocks.getClipboardText.mockResolvedValue('   ');
        render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        await screen.findByText('empty search');
        expect(mocks.directAccessParse).not.toHaveBeenCalled();
        expect(mocks.toastAdd).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
    });

    it('ignores repeated direct access while the clipboard is being read', async () => {
        let resolveClipboard!: (value: string) => void;
        mocks.getClipboardText.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveClipboard = resolve;
            })
        );
        render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        fireEvent.click(screen.getByText('clipboard'));
        await act(async () => resolveClipboard('usr_clipboard'));
        expect(mocks.getClipboardText).toHaveBeenCalledTimes(1);
        expect(mocks.directAccessParse).toHaveBeenCalledTimes(1);
    });

    it('does not reopen a dismissed search after an older operation fails', async () => {
        let resolveOpen!: (opened: boolean) => void;
        mocks.directAccessParse.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOpen = resolve;
            })
        );
        render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        await waitFor(() => expect(mocks.directAccessParse).toHaveBeenCalled());
        fireEvent.click(screen.getByText('search'));
        fireEvent.click(await screen.findByText('close'));
        await act(async () => resolveOpen(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mocks.toastAdd).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
    });

    it('discards clipboard reads when the account changes', async () => {
        let resolveClipboard!: (value: string) => void;
        mocks.getClipboardText.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveClipboard = resolve;
            })
        );
        const view = render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        mocks.currentUserId = 'usr_second';
        view.rerender(<Harness />);
        await act(async () => resolveClipboard('usr_clipboard'));
        expect(mocks.directAccessParse).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes the search when the session is no longer ready', async () => {
        const view = render(<Harness />);
        fireEvent.click(screen.getByText('search'));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        view.rerender(<Harness enabled={false} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        view.rerender(<Harness />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the same dialog mounted and retains its input until closing completes', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('search'));
        fireEvent.change(await screen.findByLabelText('query'), {
            target: { value: 'alice' }
        });
        const root = screen.getByTestId('dialog-root');
        fireEvent.click(screen.getByText('close'));

        expect(screen.getByTestId('dialog-root')).toBe(root);
        expect(root.getAttribute('data-open')).toBe('false');
        expect(screen.getByTestId('closing-query').textContent).toBe('alice');
        expect(mocks.dialogUnmounted).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('finish closing'));
        expect(screen.getByTestId('closing-query').textContent).toBe('');
        fireEvent.click(screen.getByText('search'));
        expect(screen.getByTestId('dialog-root')).toBe(root);
        expect(mocks.dialogMounted).toHaveBeenCalledTimes(1);
    });

    it('shares one dialog and starts a new detection session on every open', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('search'));
        const root = await screen.findByTestId('dialog-root');
        const session = root.getAttribute('data-clipboard-session');
        fireEvent.click(screen.getByText('menu search'));
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(root.getAttribute('data-clipboard-session')).not.toBe(session);
        const menuSession = root.getAttribute('data-clipboard-session');
        fireEvent.click(screen.getByText('search'));
        expect(root.getAttribute('data-clipboard-session')).not.toBe(
            menuSession
        );
        expect(mocks.dialogMounted).toHaveBeenCalledTimes(1);
    });

    it('starts a clean search after a failed direct open without remounting', async () => {
        mocks.directAccessParse.mockResolvedValueOnce(false);
        render(<Harness />);
        fireEvent.click(screen.getByText('clipboard'));
        await screen.findByText('usr_clipboard');
        const root = screen.getByTestId('dialog-root');
        fireEvent.click(screen.getByText('search'));
        expect(screen.getByText('empty search')).toBeTruthy();
        expect(root.getAttribute('data-retry')).toBe('');
        expect(mocks.dialogMounted).toHaveBeenCalledTimes(1);
    });

    it.each(['add', 'close'])(
        'releases busy when toast.%s throws',
        async (method) => {
            const target = method === 'add' ? mocks.toastAdd : mocks.toastClose;
            target.mockImplementationOnce(() => {
                throw new Error('toast failed');
            });
            render(<Harness />);
            fireEvent.click(screen.getByText('clipboard'));
            await act(async () => {});
            const calls = mocks.directAccessParse.mock.calls.length;
            fireEvent.click(screen.getByText('clipboard'));
            await waitFor(() =>
                expect(mocks.directAccessParse).toHaveBeenCalledTimes(calls + 1)
            );
        }
    );
});
