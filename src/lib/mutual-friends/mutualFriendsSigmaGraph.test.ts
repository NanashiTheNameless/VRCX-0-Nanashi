// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SigmaNodeEvent = {
    node: string;
    event?: { original: { detail: number } };
    preventSigmaDefault?: () => void;
};

const sigmaMock = vi.hoisted(() => ({
    handlers: new Map<string, (event: SigmaNodeEvent) => void>()
}));

vi.mock('sigma', () => ({
    default: class {
        setSetting() {}
        refresh() {}
        resize() {}
        removeAllListeners() {
            sigmaMock.handlers.clear();
        }
        on(name: string, handler: (event: SigmaNodeEvent) => void) {
            sigmaMock.handlers.set(name, handler);
        }
    }
}));
vi.mock('@sigma/edge-curve', () => ({ default: class {} }));
vi.mock('@sigma/node-border', () => ({
    createNodeBorderProgram: () => class {}
}));
vi.mock('./graphLayoutWorkerClient', () => ({
    runGraphLayoutWorker: vi.fn(async () => ({}))
}));

import { buildMutualFriendsGraphTheme } from './mutualFriendsPalette';
import { MUTUAL_GRAPH_LAYOUT_DEFAULTS } from './mutualFriendsSettings';
import { buildSigmaGraph, renderSigmaGraph } from './mutualFriendsSigmaGraph';
import type { MutualFriendGraph } from './mutualFriendsTypes';

function node(id: string) {
    return {
        id,
        label: id,
        lastFetchedAt: '2026-09-01T00:00:00.000Z',
        optedOut: false,
        degree: 1,
        mutualCount: 1
    };
}

const GRAPH: MutualFriendGraph = {
    nodes: [node('usr_target'), node('usr_a'), node('usr_b')],
    links: [
        { source: 'usr_target', target: 'usr_a' },
        { source: 'usr_target', target: 'usr_b' },
        { source: 'usr_a', target: 'usr_b' }
    ]
};

function build(forceLabels?: boolean) {
    return buildSigmaGraph({
        graph: GRAPH,
        layoutSettings: MUTUAL_GRAPH_LAYOUT_DEFAULTS,
        communityIndexById: new Map([
            ['usr_a', 0],
            ['usr_b', 1]
        ]),
        namedCommunityIndexes: new Set([0, 1]),
        theme: buildMutualFriendsGraphTheme(true),
        forceLabels
    });
}

beforeEach(() => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        }
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildSigmaGraph', () => {
    it('keeps a node outside every circle neutral and its edges out of the cross-circle highlight', async () => {
        const graph = await build();

        expect(graph.getNodeAttribute('usr_target', 'communityNamed')).toBe(
            false
        );
        expect(
            graph.getEdgeAttribute('usr_a__usr_target', 'crossCommunity')
        ).toBe(false);
        expect(graph.getEdgeAttribute('usr_a__usr_b', 'crossCommunity')).toBe(
            true
        );
    });

    it('shows every name only when asked to', async () => {
        const forced = await build(true);
        const regular = await build();

        expect(
            forced.everyNode((id) => forced.getNodeAttribute(id, 'forceLabel'))
        ).toBe(true);
        expect(
            regular.someNode((id) => regular.getNodeAttribute(id, 'forceLabel'))
        ).toBe(false);
    });

    async function renderGraph(
        callbacks: Pick<
            Parameters<typeof renderSigmaGraph>[0],
            'onSelectNode' | 'onOpenNode'
        >
    ) {
        const container = document.createElement('div');
        renderSigmaGraph({
            graph: await build(),
            container,
            instanceRef: { current: null },
            resizeObserverRef: { current: null },
            themeRef: { current: buildMutualFriendsGraphTheme(true) },
            selectedNodeIdRef: { current: '' },
            crossCommunityOnlyRef: { current: false },
            hoverCardStringsRef: {
                current: { connections: '', lastFetched: '', unavailable: '' }
            },
            ...callbacks
        });
        return container;
    }

    function emit(name: string, event: SigmaNodeEvent) {
        sigmaMock.handlers.get(name)?.(event);
    }

    it('shows a pointer over nodes so they read as clickable', async () => {
        const container = await renderGraph({ onSelectNode: vi.fn() });

        emit('enterNode', { node: 'usr_a' });
        expect(container.style.cursor).toBe('pointer');
        emit('leaveNode', { node: 'usr_a' });
        expect(container.style.cursor).toBe('');
    });

    it('reacts to a double click only once', async () => {
        const onSelectNode = vi.fn();
        const onOpenNode = vi.fn();
        await renderGraph({ onSelectNode, onOpenNode });
        const preventSigmaDefault = vi.fn();

        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 1 } }
        });
        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 2 } }
        });
        emit('doubleClickNode', { node: 'usr_a', preventSigmaDefault });

        expect(onSelectNode).toHaveBeenCalledOnce();
        expect(onOpenNode).toHaveBeenCalledOnce();
        expect(preventSigmaDefault).toHaveBeenCalledOnce();
    });

    it('opens nothing extra on double click when the graph only reacts to clicks', async () => {
        const onSelectNode = vi.fn();
        await renderGraph({ onSelectNode });
        const preventSigmaDefault = vi.fn();

        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 1 } }
        });
        emit('clickNode', {
            node: 'usr_a',
            event: { original: { detail: 2 } }
        });
        emit('doubleClickNode', { node: 'usr_a', preventSigmaDefault });

        expect(onSelectNode).toHaveBeenCalledOnce();
        expect(preventSigmaDefault).toHaveBeenCalledOnce();
    });
});
