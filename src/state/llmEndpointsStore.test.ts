import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmEndpointDto } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    upsert: vi.fn(),
    deleteEndpoint: vi.fn(),
    detectModels: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appLlmEndpointList: mocks.list,
        appLlmEndpointUpsert: mocks.upsert,
        appLlmEndpointDelete: mocks.deleteEndpoint,
        appLlmEndpointDetectModels: mocks.detectModels
    }
}));

import { mergeModels, useLlmEndpointsStore } from './llmEndpointsStore';

function endpoint(models: string[]): LlmEndpointDto {
    return {
        id: 'ep_1',
        name: 'Provider',
        baseUrl: 'https://example.com/v1',
        apiKey: '',
        hasKey: false,
        models,
        modelReasoning: [],
        lastDetectedAt: null,
        apiKind: 'openaiCompatible',
        headers: []
    };
}

describe('llmEndpointsStore helpers', () => {
    beforeEach(() => {
        mocks.list.mockReset();
        mocks.upsert.mockReset();
        mocks.deleteEndpoint.mockReset();
        mocks.detectModels.mockReset();
        useLlmEndpointsStore.setState({
            endpoints: [],
            loading: false,
            error: null
        });
    });

    it('merges model lists into a sorted unique set', () => {
        expect(
            mergeModels(['gpt-4o-mini', 'llama'], ['llama', 'qwen', ' gemma '])
        ).toEqual(['gemma', 'gpt-4o-mini', 'llama', 'qwen']);
    });

    it('drops blank entries', () => {
        expect(mergeModels(['', '  '], ['gpt-4o-mini'])).toEqual([
            'gpt-4o-mini'
        ]);
    });

    it('reloads the authoritative endpoint after persisted detection', async () => {
        const authoritative = endpoint(['authoritative-model']);
        mocks.detectModels.mockResolvedValue({
            models: ['response-model'],
            modelReasoning: []
        });
        mocks.list.mockResolvedValue([authoritative]);

        await useLlmEndpointsStore.getState().detectModels({
            id: 'ep_1',
            baseUrl: null,
            apiKey: null,
            persist: true,
            apiKind: null,
            headers: null
        });

        expect(mocks.list).toHaveBeenCalledOnce();
        expect(useLlmEndpointsStore.getState().endpoints).toEqual([
            authoritative
        ]);
    });

    it('does not let an older load overwrite a completed upsert', async () => {
        let resolveLoad: (value: LlmEndpointDto[]) => void = () => undefined;
        mocks.list.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveLoad = resolve;
                })
        );
        const saved = endpoint(['new-model']);
        mocks.upsert.mockResolvedValue(saved);

        const load = useLlmEndpointsStore.getState().load();
        const upsert = useLlmEndpointsStore.getState().upsert({
            id: 'ep_1',
            name: saved.name,
            baseUrl: saved.baseUrl,
            apiKey: null,
            models: saved.models,
            modelReasoning: null,
            apiKind: null,
            headers: null
        });
        await upsert;
        expect(useLlmEndpointsStore.getState().loading).toBe(true);

        resolveLoad([endpoint(['old-model'])]);
        await load;

        expect(useLlmEndpointsStore.getState().endpoints).toEqual([saved]);
        expect(useLlmEndpointsStore.getState().loading).toBe(false);
    });
});
