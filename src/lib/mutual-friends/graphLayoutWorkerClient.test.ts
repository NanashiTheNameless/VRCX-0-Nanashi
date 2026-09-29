import { describe, expect, it, vi } from 'vitest';

import {
    createGraphLayoutRunner,
    type GraphLayoutRequest,
    type GraphLayoutWorkerPort
} from './graphLayoutWorkerClient';

function request(requestId: string): GraphLayoutRequest {
    return {
        requestId,
        nodes: [],
        edges: [],
        settings: {
            layoutIterations: 300,
            layoutSpacing: 60,
            deltaSpacing: 0,
            reinitialize: true
        }
    };
}

function createWorkerHarness() {
    const workers: Array<{
        worker: GraphLayoutWorkerPort;
        emitMessage: (data: unknown) => void;
    }> = [];
    const createWorker = vi.fn(() => {
        let messageHandler: ((data: unknown) => void) | undefined;
        const worker: GraphLayoutWorkerPort = {
            onMessage: vi.fn((handler) => {
                messageHandler = handler;
            }),
            onError: vi.fn(),
            postMessage: vi.fn(),
            terminate: vi.fn()
        };
        workers.push({
            worker,
            emitMessage: (data) => messageHandler?.(data)
        });
        return worker;
    });

    return { createWorker, workers };
}

describe('graph layout worker client', () => {
    it('serializes layout requests so only one worker computes at a time', async () => {
        const harness = createWorkerHarness();
        const runLayout = createGraphLayoutRunner(harness.createWorker);

        const first = runLayout(request('first'));
        const second = runLayout(request('second'));
        await Promise.resolve();

        expect(harness.createWorker).toHaveBeenCalledTimes(1);
        expect(harness.workers[0].worker.postMessage).toHaveBeenCalledWith(
            request('first')
        );

        harness.workers[0].emitMessage({
            requestId: 'first',
            positions: { first: { x: 1, y: 2 } }
        });
        await expect(first).resolves.toEqual({ first: { x: 1, y: 2 } });
        expect(harness.workers[0].worker.terminate).toHaveBeenCalledOnce();
        await Promise.resolve();

        expect(harness.createWorker).toHaveBeenCalledTimes(2);
        expect(harness.workers[1].worker.postMessage).toHaveBeenCalledWith(
            request('second')
        );

        harness.workers[1].emitMessage({
            requestId: 'second',
            positions: { second: { x: 3, y: 4 } }
        });
        await expect(second).resolves.toEqual({ second: { x: 3, y: 4 } });
        expect(harness.workers[1].worker.terminate).toHaveBeenCalledOnce();
    });

    it('continues the queue after a layout failure', async () => {
        const harness = createWorkerHarness();
        const runLayout = createGraphLayoutRunner(harness.createWorker);

        const failed = runLayout(request('failed'));
        const next = runLayout(request('next'));
        await Promise.resolve();

        harness.workers[0].emitMessage({
            requestId: 'failed',
            error: 'layout failed'
        });
        await expect(failed).rejects.toThrow('layout failed');
        await Promise.resolve();

        expect(harness.createWorker).toHaveBeenCalledTimes(2);
        harness.workers[1].emitMessage({ requestId: 'next', positions: {} });
        await expect(next).resolves.toEqual({});
    });
});
