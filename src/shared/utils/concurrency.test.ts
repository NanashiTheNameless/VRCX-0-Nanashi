import { describe, expect, it } from 'vitest';

import { createConcurrencyLimiter } from './concurrency';

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function flush() {
    for (let index = 0; index < 5; index += 1) {
        await Promise.resolve();
    }
}

describe('createConcurrencyLimiter', () => {
    it('runs at most the limit at once and starts queued tasks in order', async () => {
        const limit = createConcurrencyLimiter(2);
        const gates = [deferred(), deferred(), deferred(), deferred()];
        const started: number[] = [];
        let running = 0;
        let peak = 0;
        const runs = gates.map((gate, index) =>
            limit(async () => {
                started.push(index);
                running += 1;
                peak = Math.max(peak, running);
                await gate.promise;
                running -= 1;
                return index;
            })
        );

        await flush();
        expect(started).toEqual([0, 1]);

        gates[1].resolve();
        await flush();
        expect(started).toEqual([0, 1, 2]);

        gates[0].resolve();
        gates[2].resolve();
        gates[3].resolve();

        await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3]);
        expect(peak).toBe(2);
    });

    it('frees the slot when a task fails', async () => {
        const limit = createConcurrencyLimiter(1);
        const failing = deferred();
        const first = limit(() => failing.promise);
        const second = limit(async () => 'next');

        failing.reject(new Error('boom'));

        await expect(first).rejects.toThrow('boom');
        await expect(second).resolves.toBe('next');
    });
});
