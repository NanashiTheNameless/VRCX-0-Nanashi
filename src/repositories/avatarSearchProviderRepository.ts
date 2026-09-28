import { publishPreferenceChanged } from '@/shared/events/preferenceEvents';
import { isAvatarSearchQueryLongEnough } from '@/shared/utils/avatarSearchQuery';
import { isRecord } from '@/shared/utils/record';

import avatarProfileRepository from './avatarProfileRepository';
import type { AvatarProfileRecord } from './avatarProfileRepository';
import { safeJsonParse } from './baseRepository';
import configRepository from './configRepository';
import externalApiRepository from './externalApiRepository';

export type AvatarSearchProviderConfig = {
    enabled: boolean;
    providerList: string[];
    selectedProvider: string;
    /** Providers the user switched off; every other provider is searched. */
    disabledProviders: string[];
    /** `providerList` minus `disabledProviders`, in list order. */
    activeProviders: string[];
};

type ProviderItem = Record<string, unknown>;

type AvatarSearchProviderResult = {
    avatars: AvatarProfileRecord[];
    provider: string;
    query: string;
    status: number;
    raw: unknown;
};

interface SaveConfigInput {
    enabled: boolean;
    providerList: string[];
    selectedProvider?: string;
}

interface SearchInput {
    /** Search a single provider (legacy callers). */
    provider?: string;
    /** Search these providers in parallel and merge duplicate avatars. */
    providers?: readonly string[];
    query: string;
}

const AVTRDB_PROVIDER = 'https://api.avtrdb.com/v3/avatar/search/vrcx';
const VRCDB_PROVIDER = 'https://vrcx.vrcdb.com/avatars/Avatar/VRCX';
/** Searched by default; each can be switched off individually. */
const DEFAULT_PROVIDERS = [VRCDB_PROVIDER, AVTRDB_PROVIDER];
// Adds new default providers once to lists saved before they became defaults.
const DEFAULTS_MIGRATION_KEY = 'VRCX_0_Nanashi_avatarProviderDefaultsV2';
const DISABLED_PROVIDERS_KEY = 'VRCX_0_Nanashi_avatarSearchDisabledProviders';
const AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS = [
    'avatarRemoteDatabase',
    'VRCX_avatarRemoteDatabaseProviderList',
    'VRCX_avatarRemoteDatabaseProvider',
    DISABLED_PROVIDERS_KEY
];
const LEGACY_PROVIDER_URLS = new Map<string, string | null>([
    ['https://avtr.just-h.party/vrcx_search.php', null],
    ['https://api.avtrdb.com/v1/avatar/search/vrcx', AVTRDB_PROVIDER],
    ['https://api.avtrdb.com/v2/avatar/search/vrcx', AVTRDB_PROVIDER]
]);

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function pick(value: unknown, ...keys: string[]): unknown {
    if (!isRecord(value)) {
        return undefined;
    }

    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null) {
            return value[key];
        }
    }

    return undefined;
}

function normalizeProviderList(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [...DEFAULT_PROVIDERS];
    }

    const providers: string[] = [];
    for (const rawValue of values) {
        const value = normalizeString(rawValue);
        if (!value) {
            continue;
        }

        if (LEGACY_PROVIDER_URLS.has(value)) {
            const replacement = LEGACY_PROVIDER_URLS.get(value);
            if (replacement) {
                providers.push(replacement);
            }
            continue;
        }

        providers.push(value);
    }

    return Array.from(new Set(providers));
}

function buildProviderSearchUrl(providerUrl: string, query: string): string {
    const url = new URL(providerUrl);
    url.searchParams.set('search', query);
    url.searchParams.set('n', '5000');
    return url.toString();
}

function parseResponse(data: unknown): unknown {
    if (typeof data === 'string') {
        return safeJsonParse(data, null);
    }

    return data;
}

function publishAvatarSearchProviderConfig(
    config: AvatarSearchProviderConfig
): void {
    publishPreferenceChanged('VRCX_avatarRemoteDatabaseProviderList', config);
}

function normalizeAvatarProviderItem(
    avatar: ProviderItem
): AvatarProfileRecord {
    const normalized = avatarProfileRepository.normalize({
        ...avatar,
        id: pick(avatar, 'id', 'Id', '_id', 'avatarId', 'AvatarId'),
        name: pick(avatar, 'name', 'Name'),
        description: pick(avatar, 'description', 'Description'),
        authorId: pick(avatar, 'authorId', 'AuthorId', 'author_id'),
        authorName: pick(avatar, 'authorName', 'AuthorName', 'author_name'),
        imageUrl: pick(avatar, 'imageUrl', 'ImageUrl', 'image_url'),
        thumbnailImageUrl: pick(
            avatar,
            'thumbnailImageUrl',
            'ThumbnailImageUrl',
            'thumbnail_image_url'
        ),
        created_at: pick(avatar, 'created_at', 'createdAt', 'CreatedAt'),
        updated_at: pick(avatar, 'updated_at', 'updatedAt', 'UpdatedAt'),
        releaseStatus:
            pick(avatar, 'releaseStatus', 'ReleaseStatus', 'release_status') ||
            'public'
    });

    return {
        ...normalized,
        created_at: normalized.created_at || '0001-01-01T00:00:00.0000000Z',
        updated_at: normalized.updated_at || '0001-01-01T00:00:00.0000000Z',
        releaseStatus: normalized.releaseStatus || 'public'
    };
}

async function getConfig(): Promise<AvatarSearchProviderConfig> {
    const [
        enabled,
        providerListValue,
        rawSelectedProviderValue,
        hasProviderList,
        disabledProvidersValue,
        defaultsMigrated
    ] = await Promise.all([
        configRepository.getBool('avatarRemoteDatabase', true),
        configRepository.getString(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify(DEFAULT_PROVIDERS)
        ),
        configRepository.getString('VRCX_avatarRemoteDatabaseProvider', ''),
        configRepository.has('VRCX_avatarRemoteDatabaseProviderList'),
        configRepository.getString(DISABLED_PROVIDERS_KEY, '[]'),
        configRepository.getBool(DEFAULTS_MIGRATION_KEY, false)
    ]);
    const selectedProviderValue = normalizeString(rawSelectedProviderValue);

    let parsedProviderList: unknown = safeJsonParse(
        String(providerListValue ?? ''),
        null
    );
    let parsedProviders = Array.isArray(parsedProviderList)
        ? parsedProviderList
        : [...DEFAULT_PROVIDERS];
    if (!defaultsMigrated) {
        parsedProviders = [
            ...DEFAULT_PROVIDERS.filter(
                (provider) => !parsedProviders.includes(provider)
            ),
            ...parsedProviders
        ];
        await configRepository.setBool(DEFAULTS_MIGRATION_KEY, true);
    }

    if (
        selectedProviderValue &&
        !parsedProviders.includes(selectedProviderValue)
    ) {
        parsedProviders = [...parsedProviders, selectedProviderValue];
    }

    const providerList = normalizeProviderList(parsedProviders);
    if (
        !hasProviderList ||
        JSON.stringify(providerList) !== JSON.stringify(parsedProviders)
    ) {
        await configRepository.setString(
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify(providerList)
        );
    }

    const selectedProvider = providerList.includes(selectedProviderValue)
        ? selectedProviderValue
        : providerList[0] || '';

    return withActiveProviders({
        enabled: Boolean(enabled) && providerList.length > 0,
        providerList,
        selectedProvider,
        disabledProviders: parseDisabledProviders(disabledProvidersValue)
    });
}

function parseDisabledProviders(value: unknown): string[] {
    const parsed: unknown = safeJsonParse(String(value ?? ''), null);
    return Array.isArray(parsed)
        ? Array.from(new Set(parsed.map(normalizeString).filter(Boolean)))
        : [];
}

function withActiveProviders(
    config: Omit<AvatarSearchProviderConfig, 'activeProviders'>
): AvatarSearchProviderConfig {
    const disabledProviders = config.disabledProviders.filter((provider) =>
        config.providerList.includes(provider)
    );
    return {
        ...config,
        disabledProviders,
        activeProviders: config.providerList.filter(
            (provider) => !disabledProviders.includes(provider)
        )
    };
}

async function setProviderEnabled(
    provider: string,
    enabled: boolean
): Promise<AvatarSearchProviderConfig> {
    const normalizedProvider = normalizeString(provider);
    const current = parseDisabledProviders(
        await configRepository.getString(DISABLED_PROVIDERS_KEY, '[]')
    );
    const next = enabled
        ? current.filter((entry) => entry !== normalizedProvider)
        : Array.from(new Set([...current, normalizedProvider]));
    await configRepository.setString(
        DISABLED_PROVIDERS_KEY,
        JSON.stringify(next.filter(Boolean))
    );
    publishPreferenceChanged(DISABLED_PROVIDERS_KEY, next);
    return getConfig();
}

async function saveConfig({
    enabled,
    providerList,
    selectedProvider = ''
}: SaveConfigInput): Promise<AvatarSearchProviderConfig> {
    const normalizedProviderList = normalizeProviderList(providerList);
    const persistedSelectedProvider =
        normalizeString(selectedProvider) ||
        normalizeString(
            await configRepository.getString(
                'VRCX_avatarRemoteDatabaseProvider',
                ''
            )
        );
    const resolvedSelectedProvider = normalizedProviderList.includes(
        persistedSelectedProvider
    )
        ? persistedSelectedProvider
        : normalizedProviderList[0] || '';
    await configRepository.setMany([
        [
            'VRCX_avatarRemoteDatabaseProviderList',
            JSON.stringify(normalizedProviderList)
        ],
        [
            'VRCX_avatarRemoteDatabase',
            Boolean(enabled) && normalizedProviderList.length > 0
                ? 'true'
                : 'false'
        ],
        ['VRCX_avatarRemoteDatabaseProvider', resolvedSelectedProvider]
    ]);

    const savedConfig = withActiveProviders({
        enabled: Boolean(enabled) && normalizedProviderList.length > 0,
        providerList: normalizedProviderList,
        selectedProvider: resolvedSelectedProvider,
        disabledProviders: parseDisabledProviders(
            await configRepository.getString(DISABLED_PROVIDERS_KEY, '[]')
        )
    });
    publishAvatarSearchProviderConfig(savedConfig);
    return savedConfig;
}

async function saveSelectedProvider(provider: string): Promise<string> {
    const normalizedProvider = normalizeString(provider);
    if (!normalizedProvider) {
        return '';
    }
    await configRepository.setString(
        'VRCX_avatarRemoteDatabaseProvider',
        normalizedProvider
    );
    publishPreferenceChanged(
        'VRCX_avatarRemoteDatabaseProvider',
        normalizedProvider
    );
    return normalizedProvider;
}

async function getVrcxId(): Promise<string> {
    let id = normalizeString(await configRepository.getString('id', ''));
    if (!id) {
        id = globalThis.crypto?.randomUUID?.() || '';
        if (id) {
            await configRepository.setString('id', id);
        }
    }
    return id;
}

async function searchProvider(
    provider: string,
    query: string
): Promise<AvatarSearchProviderResult> {
    const normalizedProvider = normalizeString(provider);
    const normalizedQuery = normalizeString(query);
    if (!normalizedProvider) {
        throw new Error('Avatar provider is not configured.');
    }
    if (!isAvatarSearchQueryLongEnough(normalizedQuery)) {
        throw new Error(
            'Avatar search requires at least 3 English characters or equivalent.'
        );
    }

    const [url, vrcxId] = await Promise.all([
        Promise.resolve(
            buildProviderSearchUrl(normalizedProvider, normalizedQuery)
        ),
        getVrcxId()
    ]);

    const response = await externalApiRepository.searchAvatarProvider({
        url,
        vrcxId
    });
    const json = parseResponse(response.data);

    if (response.status !== 200) {
        throw new Error(`Avatar search failed (${response.status})`);
    }
    if (!Array.isArray(json)) {
        throw new Error('Avatar provider returned an unsupported response.');
    }

    const avatars = new Map<string, AvatarProfileRecord>();
    for (const item of json) {
        const avatar = normalizeAvatarProviderItem(isRecord(item) ? item : {});
        if (avatar.id && !avatars.has(avatar.id)) {
            avatars.set(avatar.id, avatar);
        }
    }

    return {
        avatars: Array.from(avatars.values()),
        provider: normalizedProvider,
        query: normalizedQuery,
        status: response.status,
        raw: response.raw
    };
}

function isBlank(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        value === '' ||
        value === '0001-01-01T00:00:00.0000000Z'
    );
}

/**
 * Combine the same avatar reported by several providers: the first provider's
 * values win, and blanks are filled from later providers.
 */
export function mergeAvatarResults(
    resultLists: readonly (readonly AvatarProfileRecord[])[]
): AvatarProfileRecord[] {
    const merged = new Map<string, AvatarProfileRecord>();
    for (const avatars of resultLists) {
        for (const avatar of avatars) {
            if (!avatar.id) {
                continue;
            }
            const existing = merged.get(avatar.id);
            if (!existing) {
                merged.set(avatar.id, { ...avatar });
                continue;
            }
            const target = existing as Record<string, unknown>;
            for (const [key, value] of Object.entries(avatar)) {
                if (isBlank(target[key]) && !isBlank(value)) {
                    target[key] = value;
                }
            }
        }
    }
    return Array.from(merged.values());
}

async function search({
    provider,
    providers,
    query
}: SearchInput): Promise<AvatarSearchProviderResult> {
    const targets = Array.from(
        new Set(
            (providers ?? (provider ? [provider] : []))
                .map(normalizeString)
                .filter(Boolean)
        )
    );
    if (targets.length === 0) {
        throw new Error('Avatar provider is not configured.');
    }
    if (targets.length === 1) {
        return searchProvider(targets[0], query);
    }

    const settled = await Promise.allSettled(
        targets.map((target) => searchProvider(target, query))
    );
    const succeeded = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
    );
    if (succeeded.length === 0) {
        const failure = settled.find(
            (result): result is PromiseRejectedResult =>
                result.status === 'rejected'
        );
        throw failure?.reason instanceof Error
            ? failure.reason
            : new Error('Avatar search failed for every provider.');
    }
    for (const result of settled) {
        if (result.status === 'rejected') {
            console.warn('Avatar provider search failed:', result.reason);
        }
    }

    return {
        avatars: mergeAvatarResults(succeeded.map((result) => result.avatars)),
        provider: succeeded.map((result) => result.provider).join(', '),
        query: succeeded[0].query,
        status: 200,
        raw: succeeded.map((result) => result.raw)
    };
}

const avatarSearchProviderRepository = Object.freeze({
    getConfig,
    saveConfig,
    saveSelectedProvider,
    setProviderEnabled,
    getVrcxId,
    search
});

export { AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS };
export default avatarSearchProviderRepository;
