// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    endpoints: [] as { id: string; models: string[] }[],
    detectModels: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: {} }));

vi.mock('@/repositories/configRepository', () => ({
    default: { getString: vi.fn().mockResolvedValue('') }
}));

vi.mock('@/services/preferencesService', () => ({
    setDiscordBoolPreference: vi.fn(),
    setTranslationApiConfigPreference: vi.fn(),
    setYoutubeApiKeyPreference: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/state/llmEndpointsStore', () => {
    const getState = () => ({
        endpoints: mocks.endpoints,
        detectModels: mocks.detectModels
    });
    return {
        useLlmEndpointsStore: Object.assign(
            (selector: (state: ReturnType<typeof getState>) => unknown) =>
                selector(getState()),
            { getState }
        )
    };
});

import { useSettingsIntegrations } from './useSettingsIntegrations';

function renderIntegrations() {
    return renderHook(() =>
        useSettingsIntegrations({ commit: vi.fn().mockResolvedValue(true) })
    );
}

describe('useSettingsIntegrations translation models', () => {
    beforeEach(() => {
        mocks.detectModels.mockReset();
        mocks.detectModels.mockResolvedValue({
            models: ['detected-model'],
            modelReasoning: []
        });
    });

    it('keeps the configured model list of an endpoint', async () => {
        mocks.endpoints = [{ id: 'endpoint-1', models: ['manual-model'] }];
        const { result } = renderIntegrations();

        await act(() => result.current.fetchTranslationModels('endpoint-1'));

        expect(mocks.detectModels).not.toHaveBeenCalled();
    });

    it('detects models for an endpoint without models', async () => {
        mocks.endpoints = [{ id: 'endpoint-1', models: [] }];
        const { result } = renderIntegrations();

        await act(() => result.current.fetchTranslationModels('endpoint-1'));

        expect(mocks.detectModels).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'endpoint-1', persist: true })
        );
    });
});
