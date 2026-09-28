// @vitest-environment jsdom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
    preview: vi.fn(),
    apply: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn()
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            `${key.split('.').at(-1)}${options ? ` ${JSON.stringify(options)}` : ''}`
    })
}));
vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appSafetyAvatarBlockPreview: mocks.preview,
        appSafetyAvatarBlocksApply: mocks.apply,
        appSafetyAvatarBlocksCancel: mocks.cancel
    }
}));
vi.mock('@/state/modalStore', () => ({
    useModalStore: { getState: () => ({ confirm: mocks.confirm }) }
}));
import { SettingsAvatarBlocks } from './SettingsAvatarBlocks';
const preview = {
    token: 'review-token',
    accountUserId: 'usr_self',
    sourceName: 'Test source',
    updatedAt: 'today',
    total: 30,
    offset: 0,
    entries: [
        { id: 'avtr_one', name: 'First Avatar' },
        { id: 'avtr_two', name: 'Second Avatar' }
    ]
};
beforeEach(() => {
    vi.resetAllMocks();
    mocks.preview.mockResolvedValue(preview);
    mocks.apply.mockResolvedValue([{ id: 'avtr_one', outcome: 'success' }]);
    mocks.confirm.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
it('requires selected IDs and confirms the concrete account, source and IDs before blocking', async () => {
    render(<SettingsAvatarBlocks sourceId="source" disabled={false} />);
    expect(mocks.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('review_avatar_blocks'));
    await screen.findByRole('checkbox', { name: /First Avatar/ });
    expect(
        (screen.getByText('block_selected') as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /First Avatar/ }));
    fireEvent.click(screen.getByText('block_selected'));
    await waitFor(() =>
        expect(mocks.apply).toHaveBeenCalledWith('review-token', ['avtr_one'])
    );
    expect(mocks.confirm.mock.calls[0][0].description).toContain('usr_self');
    expect(mocks.confirm.mock.calls[0][0].description).toContain('avtr_one');
    expect(mocks.confirm.mock.calls[0][0].description).not.toContain(
        'avtr_two'
    );
    await screen.findByText('avtr_one: success');
});
it('does not apply a cancelled confirmation and clears selection when paging', async () => {
    mocks.confirm.mockResolvedValue({ ok: false });
    render(<SettingsAvatarBlocks sourceId="source" disabled={false} />);
    fireEvent.click(screen.getByText('review_avatar_blocks'));
    await screen.findByRole('checkbox', { name: /First Avatar/ });
    fireEvent.click(screen.getByText('select_page'));
    fireEvent.click(screen.getByText('block_selected'));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.apply).not.toHaveBeenCalled();
    await waitFor(() =>
        expect(
            (screen.getByText('next_page') as HTMLButtonElement).disabled
        ).toBe(false)
    );
    fireEvent.click(screen.getByText('next_page'));
    await waitFor(() =>
        expect(mocks.preview).toHaveBeenLastCalledWith('source', 25)
    );
    await waitFor(() =>
        expect(
            (screen.getByText('block_selected') as HTMLButtonElement).disabled
        ).toBe(true)
    );
});
it('can stop an in-progress batch and shows its result', async () => {
    let finish!: (value: { id: string; outcome: string }[]) => void;
    mocks.apply.mockReturnValue(
        new Promise((resolve) => {
            finish = resolve;
        })
    );
    render(<SettingsAvatarBlocks sourceId="source" disabled={false} />);
    fireEvent.click(screen.getByText('review_avatar_blocks'));
    await screen.findByRole('checkbox', { name: /First Avatar/ });
    fireEvent.click(screen.getByText('select_page'));
    fireEvent.click(screen.getByText('block_selected'));
    await screen.findByText('stop_remaining');
    fireEvent.click(screen.getByText('stop_remaining'));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
    finish([{ id: 'avtr_one', outcome: 'cancelled' }]);
    await screen.findByText('avtr_one: cancelled');
});
it('requires a new preview after a rejected or expired batch', async () => {
    mocks.apply.mockRejectedValue(new Error('Preview expired'));
    render(<SettingsAvatarBlocks sourceId="source" disabled={false} />);
    fireEvent.click(screen.getByText('review_avatar_blocks'));
    await screen.findByRole('checkbox', { name: /First Avatar/ });
    fireEvent.click(screen.getByText('select_page'));
    fireEvent.click(screen.getByText('block_selected'));
    await screen.findByRole('alert');
    expect(screen.queryByText('block_selected')).toBeNull();
});
