import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    ensureScreenshotThumbnail: vi.fn<(path: string) => Promise<unknown>>()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appEnsureScreenshotThumbnail: mocks.ensureScreenshotThumbnail
    }
}));

import { requestScreenshotThumbnail } from './screenshotThumbnailQueueService';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe('screenshotThumbnailQueue', () => {
    beforeEach(() => {
        mocks.ensureScreenshotThumbnail.mockReset();
    });

    it('limits active requests to two and starts queued work in FIFO order', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const third = deferred<string>();
        mocks.ensureScreenshotThumbnail
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise)
            .mockReturnValueOnce(third.promise);

        const firstRequest = requestScreenshotThumbnail('first.png');
        const secondRequest = requestScreenshotThumbnail('second.png');
        const thirdRequest = requestScreenshotThumbnail('third.png');

        expect(mocks.ensureScreenshotThumbnail.mock.calls).toEqual([
            ['first.png'],
            ['second.png']
        ]);

        first.resolve('first');
        await firstRequest.promise;
        await vi.waitFor(() => {
            expect(mocks.ensureScreenshotThumbnail).toHaveBeenNthCalledWith(
                3,
                'third.png'
            );
        });

        second.resolve('second');
        third.resolve('third');
        await expect(secondRequest.promise).resolves.toBe('second');
        await expect(thirdRequest.promise).resolves.toBe('third');
    });

    it('coalesces subscribers for the same path without cancelling started work', async () => {
        const task = deferred<string>();
        mocks.ensureScreenshotThumbnail.mockReturnValue(task.promise);

        const first = requestScreenshotThumbnail('shared.png');
        const second = requestScreenshotThumbnail('shared.png');

        expect(second.promise).toBe(first.promise);
        expect(mocks.ensureScreenshotThumbnail).toHaveBeenCalledTimes(1);

        first.cancel();
        second.cancel();
        task.resolve('thumbnail');

        await expect(first.promise).resolves.toBe('thumbnail');
        await expect(second.promise).resolves.toBe('thumbnail');
    });

    it('rejects queued work after its last subscriber cancels', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        mocks.ensureScreenshotThumbnail
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const firstRequest = requestScreenshotThumbnail('active-a.png');
        const secondRequest = requestScreenshotThumbnail('active-b.png');
        const cancelled = requestScreenshotThumbnail('cancelled.png');
        const cancellation = expect(cancelled.promise).rejects.toThrow(
            'Thumbnail request cancelled.'
        );

        cancelled.cancel();
        await cancellation;

        first.resolve('a');
        second.resolve('b');
        await Promise.all([firstRequest.promise, secondRequest.promise]);
        expect(mocks.ensureScreenshotThumbnail).not.toHaveBeenCalledWith(
            'cancelled.png'
        );
    });

    it('releases a concurrency slot after an active request fails', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const third = deferred<string>();
        mocks.ensureScreenshotThumbnail
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise)
            .mockReturnValueOnce(third.promise);

        const firstRequest = requestScreenshotThumbnail('failed.png');
        const secondRequest = requestScreenshotThumbnail('active.png');
        const thirdRequest = requestScreenshotThumbnail('next.png');
        const failure = expect(firstRequest.promise).rejects.toThrow('failed');

        first.reject(new Error('failed'));
        await failure;
        await vi.waitFor(() => {
            expect(mocks.ensureScreenshotThumbnail).toHaveBeenNthCalledWith(
                3,
                'next.png'
            );
        });

        second.resolve('active');
        third.resolve('next');
        await expect(secondRequest.promise).resolves.toBe('active');
        await expect(thirdRequest.promise).resolves.toBe('next');
    });

    it('rejects empty paths without calling the repository', async () => {
        const request = requestScreenshotThumbnail('');

        await expect(request.promise).rejects.toThrow(
            'Screenshot path is empty.'
        );
        expect(mocks.ensureScreenshotThumbnail).not.toHaveBeenCalled();
    });
});
