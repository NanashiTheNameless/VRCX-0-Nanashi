import { create } from 'zustand';

import type { LlmEndpointDto } from '@/platform/tauri/bindings';

type LlmEndpointsStatus = {
    loading: boolean;
    error: string | null;
};

type LlmEndpointsStoreState = LlmEndpointsStatus & {
    endpoints: LlmEndpointDto[];
    setStatus: (status: Partial<LlmEndpointsStatus>) => void;
    setEndpoints: (endpoints: LlmEndpointDto[]) => void;
    upsertEndpoint: (saved: LlmEndpointDto) => void;
    removeEndpoint: (id: string) => void;
};

export function mergeModels(...lists: string[][]): string[] {
    const models = lists
        .flat()
        .map((model) => model.trim())
        .filter(Boolean);
    models.sort();
    return [...new Set(models)];
}

/**
 * Fork: the default pick for endpoint selectors, the first endpoint that
 * lists a model, with that model.
 */
export function firstEndpointModel(
    endpoints: readonly LlmEndpointDto[]
): { endpointId: string; model: string } | null {
    const endpoint = endpoints.find((entry) => entry.models.length > 0);
    return endpoint
        ? { endpointId: endpoint.id, model: endpoint.models[0] }
        : null;
}

export const useLlmEndpointsStore = create<LlmEndpointsStoreState>((set) => ({
    endpoints: [],
    loading: false,
    error: null,
    setStatus(status) {
        set(status);
    },
    setEndpoints(endpoints) {
        set({ endpoints });
    },
    upsertEndpoint(saved) {
        set((state) => {
            const exists = state.endpoints.some(
                (endpoint) => endpoint.id === saved.id
            );
            return {
                endpoints: exists
                    ? state.endpoints.map((endpoint) =>
                          endpoint.id === saved.id ? saved : endpoint
                      )
                    : [...state.endpoints, saved]
            };
        });
    },
    removeEndpoint(id) {
        set((state) => ({
            endpoints: state.endpoints.filter((endpoint) => endpoint.id !== id)
        }));
    }
}));
