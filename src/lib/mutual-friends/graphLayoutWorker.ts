import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';

import type {
    GraphLayoutNodeAttributes,
    GraphLayoutPositions,
    GraphLayoutRequest,
    GraphLayoutResponse
} from './graphLayoutTypes';

type LayoutGraph = Graph<
    GraphLayoutNodeAttributes,
    Record<string, unknown>,
    Record<string, unknown>
>;

function clampNumber(value: number, min: number, max: number) {
    const normalized = Number.isFinite(value) ? value : min;
    return Math.min(max, Math.max(min, normalized));
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function jitterPositions(graph: LayoutGraph, magnitude: number) {
    graph.forEachNode((node, attrs) => {
        const { x, y } = attrs;
        if (
            typeof x !== 'number' ||
            typeof y !== 'number' ||
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return;
        }
        graph.mergeNodeAttributes(node, {
            x: x + (Math.random() - 0.5) * magnitude,
            y: y + (Math.random() - 0.5) * magnitude
        });
    });
}

function initPositions(graph: LayoutGraph) {
    const radius = Math.max(50, Math.sqrt(graph.order) * 30);
    graph.forEachNode((node) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * radius;
        graph.mergeNodeAttributes(node, {
            x: Math.cos(angle) * distance,
            y: Math.sin(angle) * distance
        });
    });
}

const LAYOUT_SPACING_MIN = 8;
const LAYOUT_SPACING_MAX = 240;
const LAYOUT_ITERATIONS_MIN = 300;
const LAYOUT_ITERATIONS_MAX = 1500;

function runLayout(data: GraphLayoutRequest): GraphLayoutPositions {
    const { nodes, edges, settings } = data;
    const graph: LayoutGraph = new Graph({
        type: 'undirected',
        multi: false,
        allowSelfLoops: false
    });

    for (const node of nodes) {
        graph.addNode(node.id, node.attributes);
    }
    for (const edge of edges) {
        graph.addEdgeWithKey(
            edge.key,
            edge.source,
            edge.target,
            edge.attributes
        );
    }

    if (settings.reinitialize ?? false) {
        initPositions(graph);
    }

    const iterations = clampNumber(
        settings.layoutIterations,
        LAYOUT_ITERATIONS_MIN,
        LAYOUT_ITERATIONS_MAX
    );
    const spacing = clampNumber(
        settings.layoutSpacing,
        LAYOUT_SPACING_MIN,
        LAYOUT_SPACING_MAX
    );
    const clampedT = clampNumber(
        (spacing - LAYOUT_SPACING_MIN) /
            (LAYOUT_SPACING_MAX - LAYOUT_SPACING_MIN),
        0,
        1
    );
    const deltaSpacing = settings.deltaSpacing ?? 0;
    const inferred = forceAtlas2.inferSettings
        ? forceAtlas2.inferSettings(graph)
        : {};

    if (Math.abs(deltaSpacing) >= 8) {
        jitterPositions(graph, lerp(0.5, 2.0, clampedT));
    }

    forceAtlas2.assign(graph, {
        iterations,
        settings: {
            ...inferred,
            barnesHutOptimize: true,
            barnesHutTheta: 0.8,
            strongGravityMode: true,
            gravity: lerp(1.6, 0.6, clampedT),
            scalingRatio: spacing,
            slowDown: 2
        }
    });

    noverlap.assign(graph, {
        maxIterations: clampNumber(
            Math.round(Math.sqrt(graph.order) * 6),
            200,
            600
        ),
        settings: {
            ratio: lerp(1.05, 1.35, clampedT),
            margin: lerp(1, 8, clampedT)
        }
    });

    const positions: GraphLayoutPositions = {};
    graph.forEachNode((node, attrs) => {
        if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') {
            throw new Error(`Graph layout did not position node ${node}.`);
        }
        positions[node] = { x: attrs.x, y: attrs.y };
    });
    return positions;
}

self.addEventListener('message', (event: MessageEvent<GraphLayoutRequest>) => {
    const { requestId } = event.data;
    try {
        const response: GraphLayoutResponse = {
            requestId,
            positions: runLayout(event.data)
        };
        self.postMessage(response);
    } catch (error) {
        const response: GraphLayoutResponse = {
            requestId,
            error: error instanceof Error ? error.message : String(error)
        };
        self.postMessage(response);
    }
});
