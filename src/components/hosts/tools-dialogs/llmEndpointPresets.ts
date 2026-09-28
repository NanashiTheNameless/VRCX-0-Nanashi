import type {
    LlmApiKind,
    LlmHeader,
    LlmModelReasoning
} from '@/platform/tauri/bindings';

export const CUSTOM_LLM_ENDPOINT_PROVIDER_ID = 'custom';
export const DEFAULT_LLM_ENDPOINT_PROVIDER_ID = 'openai';

export type LlmEndpointProviderId =
    | 'openai'
    | 'openai-chat'
    | 'anthropic'
    | 'gemini-native'
    | 'openrouter'
    | 'gemini'
    | 'groq'
    | 'together'
    | 'mistral'
    | 'deepseek'
    | 'xai'
    | 'siliconflow'
    | 'azure'
    | 'cohere'
    | 'bedrock'
    | 'vertex'
    | 'ollama'
    | 'ollama-openai'
    | 'lmstudio'
    | 'llamacpp'
    | 'vllm'
    | typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID;

export const LLM_API_KINDS: { value: LlmApiKind; label: string }[] = [
    {
        value: 'openaiCompatible',
        label: 'OpenAI-compatible (/chat/completions)'
    },
    { value: 'openaiResponses', label: 'OpenAI native (/responses)' },
    { value: 'anthropic', label: 'Anthropic Messages (/v1/messages)' },
    { value: 'gemini', label: 'Google Gemini (generateContent)' },
    { value: 'ollama', label: 'Ollama native (/api/chat)' },
    { value: 'azureOpenai', label: 'Azure OpenAI (api-key, api-version)' },
    { value: 'cohere', label: 'Cohere v2 (/v2/chat)' },
    { value: 'bedrock', label: 'Amazon Bedrock Converse (API key)' },
    { value: 'vertexAi', label: 'Google Vertex AI (Gemini)' }
];

export function isLlmApiKind(value: unknown): value is LlmApiKind {
    return LLM_API_KINDS.some((kind) => kind.value === value);
}

// One header per line, `Name: value`. Blank lines and lines without a colon are ignored.
export function parseLlmHeaders(text: string): LlmHeader[] {
    return text
        .split(/\r?\n/)
        .map((line) => {
            const index = line.indexOf(':');
            if (index <= 0) {
                return null;
            }
            const name = line.slice(0, index).trim();
            const value = line.slice(index + 1).trim();
            return name ? { name, value } : null;
        })
        .filter((header): header is LlmHeader => header !== null);
}

export function formatLlmHeaders(headers: LlmHeader[]): string {
    return headers
        .map((header) => `${header.name}: ${header.value}`)
        .join('\n');
}

export type LlmEndpointProviderPreset = {
    id: Exclude<LlmEndpointProviderId, typeof CUSTOM_LLM_ENDPOINT_PROVIDER_ID>;
    name: string;
    label: string;
    labelKey?: string;
    baseUrl: string;
    apiKind: LlmApiKind;
};

export type LlmEndpointProviderDraft = {
    id: string | null;
    savedBaseUrl: string | null;
    providerId: LlmEndpointProviderId;
    name: string;
    baseUrl: string;
    apiKey: string;
    clearKey: boolean;
    models: string[];
    detectedModelReasoning: LlmModelReasoning[] | null;
    apiKind: LlmApiKind;
    savedApiKind: LlmApiKind | null;
    headersText: string;
    savedHeadersText: string | null;
};

export const LLM_ENDPOINT_PROVIDER_PRESETS: LlmEndpointProviderPreset[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        label: 'OpenAI (native)',
        baseUrl: 'https://api.openai.com/v1',
        apiKind: 'openaiResponses'
    },
    {
        id: 'openai-chat',
        name: 'OpenAI (OpenAI-compatible)',
        label: 'OpenAI (OpenAI-compatible)',
        baseUrl: 'https://api.openai.com/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        label: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKind: 'anthropic'
    },
    {
        id: 'gemini-native',
        name: 'Google Gemini (native)',
        label: 'Google Gemini (native API)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKind: 'gemini'
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        label: 'Google Gemini (OpenAI-compatible)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'groq',
        name: 'Groq',
        label: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'together',
        name: 'Together AI',
        label: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'mistral',
        name: 'Mistral',
        label: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'xai',
        name: 'xAI',
        label: 'xAI (Grok)',
        baseUrl: 'https://api.x.ai/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        label: 'SiliconFlow',
        labelKey: 'view.tools.llm_endpoints.presets.siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'azure',
        name: 'Azure OpenAI',
        label: 'Azure OpenAI',
        baseUrl:
            'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
        apiKind: 'azureOpenai'
    },
    {
        id: 'cohere',
        name: 'Cohere',
        label: 'Cohere',
        baseUrl: 'https://api.cohere.com',
        apiKind: 'cohere'
    },
    {
        id: 'bedrock',
        name: 'Amazon Bedrock',
        label: 'Amazon Bedrock (API key)',
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        apiKind: 'bedrock'
    },
    {
        id: 'vertex',
        name: 'Google Vertex AI',
        label: 'Google Vertex AI',
        baseUrl:
            'https://aiplatform.googleapis.com/v1/projects/YOUR-PROJECT/locations/global/publishers/google',
        apiKind: 'vertexAi'
    },
    {
        id: 'ollama',
        name: 'Ollama',
        label: 'Ollama (local or LAN, native API)',
        baseUrl: 'http://localhost:11434',
        apiKind: 'ollama'
    },
    {
        id: 'ollama-openai',
        name: 'Ollama (OpenAI)',
        label: 'Ollama (OpenAI-compatible)',
        baseUrl: 'http://localhost:11434/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'lmstudio',
        name: 'LM Studio',
        label: 'LM Studio (local or LAN)',
        baseUrl: 'http://localhost:1234/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'llamacpp',
        name: 'llama.cpp',
        label: 'llama.cpp server (local or LAN)',
        baseUrl: 'http://localhost:8080/v1',
        apiKind: 'openaiCompatible'
    },
    {
        id: 'vllm',
        name: 'vLLM',
        label: 'vLLM (local or LAN)',
        baseUrl: 'http://localhost:8000/v1',
        apiKind: 'openaiCompatible'
    }
];

export function isLlmEndpointProviderId(
    value: string | null | undefined
): value is LlmEndpointProviderId {
    return (
        value === CUSTOM_LLM_ENDPOINT_PROVIDER_ID ||
        LLM_ENDPOINT_PROVIDER_PRESETS.some((preset) => preset.id === value)
    );
}

function normalizeLlmEndpointPresetBaseUrl(raw: string): string {
    let value = raw.trim().replace(/\/+$/, '');
    if (value.toLowerCase().endsWith('/chat/completions')) {
        value = value.slice(0, -'/chat/completions'.length);
    }
    return value.replace(/\/+$/, '');
}

export function findLlmEndpointProviderId(
    baseUrl: string,
    name: string
): LlmEndpointProviderId {
    const normalizedBaseUrl = normalizeLlmEndpointPresetBaseUrl(baseUrl);
    const normalizedName = name.trim();
    return (
        LLM_ENDPOINT_PROVIDER_PRESETS.find(
            (preset) =>
                preset.name === normalizedName &&
                normalizeLlmEndpointPresetBaseUrl(preset.baseUrl) ===
                    normalizedBaseUrl
        )?.id ?? CUSTOM_LLM_ENDPOINT_PROVIDER_ID
    );
}

function getLlmEndpointProviderPreset(
    providerId: LlmEndpointProviderId
): LlmEndpointProviderPreset | null {
    return (
        LLM_ENDPOINT_PROVIDER_PRESETS.find(
            (preset) => preset.id === providerId
        ) ?? null
    );
}

export function applyLlmEndpointProviderPreset(
    draft: LlmEndpointProviderDraft,
    providerId: LlmEndpointProviderId
): LlmEndpointProviderDraft {
    const preset = getLlmEndpointProviderPreset(providerId);
    if (!preset) {
        return {
            ...draft,
            providerId: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null,
            apiKind: 'openaiCompatible'
        };
    }

    const targetChanged =
        normalizeLlmEndpointPresetBaseUrl(draft.baseUrl) !==
        normalizeLlmEndpointPresetBaseUrl(preset.baseUrl);

    return {
        ...draft,
        providerId: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKind: preset.apiKind,
        apiKey: targetChanged ? '' : draft.apiKey,
        clearKey: targetChanged ? false : draft.clearKey,
        models: [],
        detectedModelReasoning: null
    };
}

export function applyLlmEndpointBaseUrl(
    draft: LlmEndpointProviderDraft,
    baseUrl: string
): LlmEndpointProviderDraft {
    const targetChanged =
        normalizeLlmEndpointPresetBaseUrl(draft.baseUrl) !==
        normalizeLlmEndpointPresetBaseUrl(baseUrl);
    return {
        ...draft,
        baseUrl,
        providerId: findLlmEndpointProviderId(baseUrl, draft.name),
        apiKey: targetChanged ? '' : draft.apiKey,
        clearKey: targetChanged ? false : draft.clearKey,
        detectedModelReasoning: null
    };
}

export function shouldUseSavedLlmEndpointForDetect(
    draft: LlmEndpointProviderDraft
): boolean {
    if (!draft.id || !draft.savedBaseUrl || draft.apiKey.trim()) {
        return false;
    }
    if (draft.clearKey) {
        return false;
    }
    if (
        draft.savedApiKind !== draft.apiKind ||
        draft.savedHeadersText !== draft.headersText
    ) {
        return false;
    }
    return (
        normalizeLlmEndpointPresetBaseUrl(draft.baseUrl) ===
        normalizeLlmEndpointPresetBaseUrl(draft.savedBaseUrl)
    );
}

export function createEmptyLlmEndpointDraft(): LlmEndpointProviderDraft {
    return applyLlmEndpointProviderPreset(
        {
            id: null,
            savedBaseUrl: null,
            providerId: DEFAULT_LLM_ENDPOINT_PROVIDER_ID,
            name: '',
            baseUrl: '',
            apiKey: '',
            clearKey: false,
            models: [],
            detectedModelReasoning: null,
            apiKind: 'openaiCompatible',
            savedApiKind: null,
            headersText: '',
            savedHeadersText: null
        },
        DEFAULT_LLM_ENDPOINT_PROVIDER_ID
    );
}
