export type GraphLayoutNodeAttributes = Record<string, unknown> & {
    x?: number;
    y?: number;
};

export type GraphLayoutRequest = {
    requestId: string;
    nodes: Array<{ id: string; attributes: GraphLayoutNodeAttributes }>;
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

export type GraphLayoutPositions = Record<string, { x: number; y: number }>;

export type GraphLayoutResponse = {
    requestId: string;
    error?: string;
    positions?: GraphLayoutPositions;
};
