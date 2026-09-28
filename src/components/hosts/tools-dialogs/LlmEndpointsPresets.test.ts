import { describe, expect, it } from 'vitest';

import {
    CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
    DEFAULT_LLM_ENDPOINT_PROVIDER_ID,
    LLM_ENDPOINT_PROVIDER_PRESETS,
    applyLlmEndpointBaseUrl,
    applyLlmEndpointProviderPreset,
    createEmptyLlmEndpointDraft,
    findLlmEndpointProviderId,
    shouldUseSavedLlmEndpointForDetect,
    type LlmEndpointProviderDraft
} from './llmEndpointPresets';

function draft(): LlmEndpointProviderDraft {
    return {
        id: 'ep_1',
        savedBaseUrl: 'https://example.test/v1',
        providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
        name: 'Manual',
        baseUrl: 'https://example.test/v1',
        apiKey: 'sk-existing',
        clearKey: true,
        models: ['manual-model'],
        detectedModelReasoning: null,
        apiKind: 'openaiCompatible',
        savedApiKind: 'openaiCompatible',
        headersText: '',
        savedHeadersText: ''
    };
}

describe('LLM endpoint presets', () => {
    it('exposes presets in the agreed order and defaults new drafts to OpenAI', () => {
        expect(
            LLM_ENDPOINT_PROVIDER_PRESETS.map((preset) => preset.id)
        ).toEqual([
            'openai',
            'openai-chat',
            'anthropic',
            'gemini-native',
            'openrouter',
            'gemini',
            'groq',
            'together',
            'mistral',
            'deepseek',
            'xai',
            'siliconflow',
            'azure',
            'cohere',
            'bedrock',
            'vertex',
            'ollama',
            'ollama-openai',
            'lmstudio',
            'llamacpp',
            'vllm'
        ]);
        expect(DEFAULT_LLM_ENDPOINT_PROVIDER_ID).toBe('openai');
        expect(createEmptyLlmEndpointDraft()).toMatchObject({
            providerId: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKind: 'openaiResponses'
        });
    });

    it('matches presets by normalized base URL and preset name', () => {
        expect(
            findLlmEndpointProviderId(
                ' https://api.openai.com/v1/chat/completions/ ',
                'OpenAI'
            )
        ).toBe('openai');
        expect(
            findLlmEndpointProviderId(
                'https://api.openai.com/v1',
                'OpenAI (OpenAI-compatible)'
            )
        ).toBe('openai-chat');
        expect(
            findLlmEndpointProviderId('https://api.deepseek.com/', 'DeepSeek')
        ).toBe('deepseek');
        expect(
            findLlmEndpointProviderId(
                'https://generativelanguage.googleapis.com/v1beta/openai/',
                'Google Gemini'
            )
        ).toBe('gemini');
        expect(
            findLlmEndpointProviderId(
                'https://api.openai.com/v1',
                'Renamed OpenAI'
            )
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
        expect(
            findLlmEndpointProviderId('https://example.test/v1', 'Manual')
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
        expect(
            findLlmEndpointProviderId('https://api.openai.com/v1', ' OpenAI ')
        ).toBe('openai');
        expect(
            findLlmEndpointProviderId('https://api.openai.com/v1', 'openai')
        ).toBe(CUSTOM_LLM_ENDPOINT_PROVIDER_ID);
    });

    it('applies a preset while dropping credentials from the previous target', () => {
        expect(applyLlmEndpointProviderPreset(draft(), 'xai')).toMatchObject({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: 'xai',
            name: 'xAI',
            baseUrl: 'https://api.x.ai/v1',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null
        });
    });

    it('applies additional common provider presets', () => {
        expect(
            applyLlmEndpointProviderPreset(draft(), 'openrouter')
        ).toMatchObject({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: 'openrouter',
            name: 'OpenRouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null
        });
        expect(
            applyLlmEndpointProviderPreset(draft(), 'siliconflow')
        ).toMatchObject({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: 'siliconflow',
            name: 'SiliconFlow',
            baseUrl: 'https://api.siliconflow.cn/v1',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null
        });
    });

    it('drops credentials when a custom base URL changes targets', () => {
        expect(
            applyLlmEndpointBaseUrl(draft(), 'https://other.example/v1')
        ).toMatchObject({
            baseUrl: 'https://other.example/v1',
            apiKey: '',
            clearKey: false
        });
        expect(
            applyLlmEndpointBaseUrl(draft(), 'https://example.test/v1/')
        ).toMatchObject({
            apiKey: 'sk-existing',
            clearKey: true
        });
    });

    it('clears editable fields when selecting custom', () => {
        expect(
            applyLlmEndpointProviderPreset(
                draft(),
                CUSTOM_LLM_ENDPOINT_PROVIDER_ID
            )
        ).toMatchObject({
            id: 'ep_1',
            savedBaseUrl: 'https://example.test/v1',
            providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null
        });
    });

    it('uses a saved endpoint for detect only when draft connection state is unchanged', () => {
        const unchangedDraft = {
            ...draft(),
            apiKey: '',
            clearKey: false
        };

        expect(shouldUseSavedLlmEndpointForDetect(unchangedDraft)).toBe(true);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                baseUrl: 'https://example.test/v1/'
            })
        ).toBe(true);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                baseUrl: 'https://api.deepseek.com'
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                apiKey: 'sk-new'
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                clearKey: true
            })
        ).toBe(false);
        expect(
            shouldUseSavedLlmEndpointForDetect({
                ...unchangedDraft,
                id: null,
                savedBaseUrl: null
            })
        ).toBe(false);
    });
});
