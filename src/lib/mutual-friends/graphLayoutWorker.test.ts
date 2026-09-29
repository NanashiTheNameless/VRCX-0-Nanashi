import { beforeEach, describe, expect, it, vi } from 'vitest';

type NodeAttributes = Record<string, unknown> & {
    x?: number;
    y?: number;
};

class FakeGraph {
    private readonly nodes = new Map<string, NodeAttributes>();

    addNode(id: string, attributes: NodeAttributes = {}) {
        this.nodes.set(id, { ...attributes });
    }

    addEdgeWithKey(
        _key: string,
        source: string,
        target: string,
        _attributes: Record<string, unknown> = {}
    ) {
        if (!this.nodes.has(source) || !this.nodes.has(target)) {
            throw new Error('missing node');
        }
    }

    get order() {
        return this.nodes.size;
    }

    forEachNode(callback: (id: string, attributes: NodeAttributes) => void) {
        for (const [id, attributes] of this.nodes.entries()) {
            callback(id, attributes);
        }
    }

    mergeNodeAttributes(id: string, attributes: NodeAttributes) {
        this.nodes.set(id, {
            ...this.nodes.get(id),
            ...attributes
        });
    }
}

const layoutMocks = vi.hoisted(() => ({
    forceAtlasAssign: vi.fn(),
    noverlapAssign: vi.fn()
}));

vi.mock('graphology', () => ({ default: FakeGraph }));
vi.mock('graphology-layout-forceatlas2', () => ({
    default: {
        inferSettings: vi.fn(() => ({ gravity: 1 })),
        assign: layoutMocks.forceAtlasAssign.mockImplementation(
            (graph: FakeGraph) => {
                graph.forEachNode((id, attributes) => {
                    graph.mergeNodeAttributes(id, {
                        x:
                            typeof attributes.x === 'number'
                                ? attributes.x + 1
                                : 1,
                        y:
                            typeof attributes.y === 'number'
                                ? attributes.y + 1
                                : 1
                    });
                });
            }
        )
    }
}));
vi.mock('graphology-layout-noverlap', () => ({
    default: {
        assign: layoutMocks.noverlapAssign
    }
}));

type WorkerRequest = {
    requestId: number;
    nodes: Array<{ id: string; attributes: NodeAttributes }>;
    edges: Array<{
        key: string;
        source: string;
        target: string;
        attributes: Record<string, unknown>;
    }>;
    settings: {
        layoutIterations: number;
        layoutSpacing: number;
        deltaSpacing: number;
        reinitialize: boolean;
    };
};

type WorkerResponse = {
    requestId: number;
    error?: string;
    positions?: Record<string, { x: number; y: number }>;
};

function setupWorkerHarness() {
    const sent: WorkerResponse[] = [];
    let handler: ((event: { data: WorkerRequest }) => void) | null = null;
    const worker = {
        addEventListener: vi.fn(
            (
                eventName: string,
                callback: (event: { data: WorkerRequest }) => void
            ) => {
                if (eventName === 'message') {
                    handler = callback;
                }
            }
        ),
        postMessage: vi.fn((payload: WorkerResponse) => {
            sent.push(payload);
        })
    };
    vi.stubGlobal('self', worker);

    return {
        sent,
        dispatch(data: WorkerRequest) {
            handler?.({ data });
        }
    };
}

function request(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
    return {
        requestId: 11,
        nodes: [
            { id: 'n1', attributes: { x: 0, y: 0 } },
            { id: 'n2', attributes: { x: 2, y: 2 } }
        ],
        edges: [
            {
                key: 'n1__n2',
                source: 'n1',
                target: 'n2',
                attributes: {}
            }
        ],
        settings: {
            layoutIterations: 300,
            layoutSpacing: 60,
            deltaSpacing: 0,
            reinitialize: false
        },
        ...overrides
    };
}

describe('graphLayoutWorker message protocol', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns positions with the same requestId on success', async () => {
        const harness = setupWorkerHarness();
        await import('./graphLayoutWorker');

        harness.dispatch(request());

        expect(harness.sent).toEqual([
            {
                requestId: 11,
                positions: {
                    n1: { x: 1, y: 1 },
                    n2: { x: 3, y: 3 }
                }
            }
        ]);
    });

    it('returns an error with the requestId when graph reconstruction fails', async () => {
        const harness = setupWorkerHarness();
        await import('./graphLayoutWorker');

        harness.dispatch(
            request({
                requestId: 12,
                nodes: [{ id: 'n1', attributes: { x: 0, y: 0 } }]
            })
        );

        expect(harness.sent).toEqual([
            { requestId: 12, error: 'missing node' }
        ]);
    });

    it('clamps layout settings before invoking the layout libraries', async () => {
        const harness = setupWorkerHarness();
        await import('./graphLayoutWorker');

        harness.dispatch(
            request({
                settings: {
                    layoutIterations: 10_000,
                    layoutSpacing: -20,
                    deltaSpacing: 0,
                    reinitialize: false
                }
            })
        );

        expect(layoutMocks.forceAtlasAssign).toHaveBeenCalledWith(
            expect.any(FakeGraph),
            expect.objectContaining({
                iterations: 1500,
                settings: expect.objectContaining({ scalingRatio: 8 })
            })
        );
        expect(layoutMocks.noverlapAssign).toHaveBeenCalledWith(
            expect.any(FakeGraph),
            expect.objectContaining({ maxIterations: 200 })
        );
    });
});
