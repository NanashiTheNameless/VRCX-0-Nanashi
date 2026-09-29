import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    listen: vi.fn()
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: mocks.listen
}));

import { clearTauriEventListeners, onTauriEvent } from './events';

describe('tauri events', () => {
    beforeEach(() => {
        clearTauriEventListeners();
        mocks.listen.mockReset();
    });

    afterEach(() => {
        clearTauriEventListeners();
        vi.restoreAllMocks();
    });

    it('shares a Tauri listener until the last handler leaves', async () => {
        const unlisten = vi.fn();
        mocks.listen.mockResolvedValue(unlisten);
        const firstHandler = vi.fn();
        const secondHandler = vi.fn();

        const [offFirst, offSecond] = await Promise.all([
            onTauriEvent('shared-event', firstHandler),
            onTauriEvent('shared-event', secondHandler)
        ]);

        expect(mocks.listen).toHaveBeenCalledTimes(1);
        const dispatch = mocks.listen.mock.calls[0]?.[1];
        dispatch({ payload: { value: 1 } });
        expect(firstHandler).toHaveBeenCalledWith({ value: 1 });
        expect(secondHandler).toHaveBeenCalledWith({ value: 1 });

        offFirst();
        expect(unlisten).not.toHaveBeenCalled();

        offSecond();
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('allows a subscription to retry after listen rejects', async () => {
        const unlisten = vi.fn();
        mocks.listen
            .mockRejectedValueOnce(new Error('listen failed'))
            .mockResolvedValueOnce(unlisten);

        await expect(onTauriEvent('retry-event', vi.fn())).rejects.toThrow(
            'listen failed'
        );

        const off = await onTauriEvent('retry-event', vi.fn());

        expect(mocks.listen).toHaveBeenCalledTimes(2);
        off();
    });

    it('continues dispatching when one handler throws', async () => {
        const error = new Error('handler failed');
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        mocks.listen.mockResolvedValue(vi.fn());
        const healthyHandler = vi.fn();

        await onTauriEvent('dispatch-event', () => {
            throw error;
        });
        await onTauriEvent('dispatch-event', healthyHandler);

        const dispatch = mocks.listen.mock.calls[0]?.[1];
        dispatch({ payload: 'payload' });

        expect(healthyHandler).toHaveBeenCalledWith('payload');
        expect(consoleError).toHaveBeenCalledWith(
            'Error in Tauri event handler for dispatch-event:',
            error
        );
    });
});
