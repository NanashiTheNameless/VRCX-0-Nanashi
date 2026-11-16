// Fork: finding VRChat codes on the web. Nothing is searched until the user
// picks a search engine; there is no default. Browser links only open the
// browser; the in-app search sends the query to the engine the user chose.

import { commands, type CodeSearchProvider } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';

export const DEFAULT_CODE_SEARCH_QUERY = 'VRChat redeem code';
export const OFFICIAL_CODE_SEARCH_QUERY =
    'VRChat redeem code (site:hello.vrchat.com OR site:ask.vrchat.com OR site:x.com/VRChat OR site:bsky.app/profile/vrchat.com)';

export const CODE_SEARCH_LINK_ENGINES = {
    duckduckgo: 'https://duckduckgo.com/?q={query}',
    google: 'https://www.google.com/search?q={query}',
    bing: 'https://www.bing.com/search?q={query}',
    brave: 'https://search.brave.com/search?q={query}',
    startpage: 'https://www.startpage.com/do/search?q={query}',
    ecosia: 'https://www.ecosia.org/search?q={query}'
} as const;

export type CodeSearchLinkEngine =
    | ''
    | keyof typeof CODE_SEARCH_LINK_ENGINES
    | 'custom';

export type CodeSearchSettings = {
    linkEngine: CodeSearchLinkEngine;
    linkTemplate: string;
    provider: '' | CodeSearchProvider;
    apiKey: string;
    googleEngineId: string;
    searxngEndpoint: string;
};

// Every key starts with "codeSearch", which Settings Sync leaves out: these
// are this PC's choices and may hold keys or a server address.
const KEYS = {
    linkEngine: 'codeSearchLinkEngine',
    linkTemplate: 'codeSearchLinkTemplate',
    provider: 'codeSearchProvider',
    apiKey: 'codeSearchApiKey',
    googleEngineId: 'codeSearchGoogleEngineId',
    searxngEndpoint: 'codeSearchSearxngEndpoint'
} as const satisfies Record<keyof CodeSearchSettings, string>;

const LINK_ENGINES = new Set<string>([
    '',
    'custom',
    ...Object.keys(CODE_SEARCH_LINK_ENGINES)
]);
const PROVIDERS = new Set<string>(['', 'brave', 'google', 'searxng']);

export async function loadCodeSearchSettings(): Promise<CodeSearchSettings> {
    const read = (key: string) => configRepository.getString(key, '');
    const [
        linkEngine,
        linkTemplate,
        provider,
        apiKey,
        googleEngineId,
        searxngEndpoint
    ] = await Promise.all([
        read(KEYS.linkEngine),
        read(KEYS.linkTemplate),
        read(KEYS.provider),
        read(KEYS.apiKey),
        read(KEYS.googleEngineId),
        read(KEYS.searxngEndpoint)
    ]);
    return {
        linkEngine: (LINK_ENGINES.has(linkEngine)
            ? linkEngine
            : '') as CodeSearchLinkEngine,
        linkTemplate,
        provider: (PROVIDERS.has(provider) ? provider : '') as
            | ''
            | CodeSearchProvider,
        apiKey,
        googleEngineId,
        searxngEndpoint
    };
}

export async function saveCodeSearchSetting<K extends keyof CodeSearchSettings>(
    key: K,
    value: CodeSearchSettings[K]
): Promise<void> {
    await configRepository.setString(KEYS[key], String(value).trim());
}

function isWebUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

/** A custom link must be a web address with {query} where the words go. */
export function isValidLinkTemplate(template: string): boolean {
    const value = template.trim();
    return (
        value.includes('{query}') && isWebUrl(value.replace('{query}', 'test'))
    );
}

/** The browser link for a search, or null when no engine is chosen. */
export function codeSearchLinkUrl(
    settings: Pick<CodeSearchSettings, 'linkEngine' | 'linkTemplate'>,
    query: string
): string | null {
    const template =
        settings.linkEngine === 'custom'
            ? settings.linkTemplate.trim()
            : settings.linkEngine
              ? CODE_SEARCH_LINK_ENGINES[settings.linkEngine]
              : '';
    if (!template || !isValidLinkTemplate(template)) {
        return null;
    }
    return template.replace('{query}', encodeURIComponent(query));
}

/** Whether the in-app search has what its engine needs. */
export function canSearchInApp(settings: CodeSearchSettings): boolean {
    switch (settings.provider) {
        case 'brave':
            return Boolean(settings.apiKey.trim());
        case 'google':
            return Boolean(
                settings.apiKey.trim() && settings.googleEngineId.trim()
            );
        case 'searxng':
            return isWebUrl(settings.searxngEndpoint.trim());
        default:
            return false;
    }
}

export type CodeSearchResult = {
    title: string;
    url: string;
    snippet: string;
    codes: string[];
};

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

// Engines mark matches with HTML; keep the words.
function plain(value: string): string {
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

const NOT_CODES = new Set(['VRCHAT', 'HTTPS', 'HTTP', 'VRCPLUS']);

/**
 * Words that look like a code: 6 to 30 capital letters, digits and dashes,
 * with at least one letter and one digit. Only a hint; VRChat decides.
 */
export function findCodeCandidates(value: string): string[] {
    const found = new Set<string>();
    for (const match of value.matchAll(
        /\b[A-Z0-9][A-Z0-9-]{4,28}[A-Z0-9]\b/g
    )) {
        const code = match[0];
        if (
            /[A-Z]/.test(code) &&
            /\d/.test(code) &&
            !NOT_CODES.has(code.replace(/-/g, ''))
        ) {
            found.add(code);
        }
    }
    return [...found];
}

function rows(value: unknown, key: string): Record<string, unknown>[] {
    const list =
        value && typeof value === 'object'
            ? (value as Record<string, unknown>)[key]
            : undefined;
    return Array.isArray(list)
        ? list.filter(
              (row): row is Record<string, unknown> =>
                  Boolean(row) && typeof row === 'object'
          )
        : [];
}

export function parseCodeSearchResults(
    provider: CodeSearchProvider,
    json: unknown
): CodeSearchResult[] {
    const raw =
        provider === 'brave'
            ? rows(
                  json && typeof json === 'object'
                      ? (json as Record<string, unknown>).web
                      : undefined,
                  'results'
              ).map((row) => ({
                  title: text(row.title),
                  url: text(row.url),
                  snippet: [
                      text(row.description),
                      ...(Array.isArray(row.extra_snippets)
                          ? row.extra_snippets.map(text)
                          : [])
                  ].join(' ')
              }))
            : provider === 'google'
              ? rows(json, 'items').map((row) => ({
                    title: text(row.title),
                    url: text(row.link),
                    snippet: text(row.snippet)
                }))
              : rows(json, 'results').map((row) => ({
                    title: text(row.title),
                    url: text(row.url),
                    snippet: text(row.content)
                }));
    return raw
        .filter((row) => isWebUrl(row.url))
        .map((row) => {
            const title = plain(row.title);
            const snippet = plain(row.snippet);
            return {
                title: title || row.url,
                url: row.url,
                snippet,
                codes: findCodeCandidates(`${title} ${snippet}`)
            };
        });
}

export async function searchForCodes(
    settings: CodeSearchSettings,
    query: string
): Promise<CodeSearchResult[]> {
    if (!settings.provider || !canSearchInApp(settings)) {
        throw new Error('Choose and set up a search engine first.');
    }
    const response = await commands.appExternalApiCodeSearchGet({
        provider: settings.provider,
        query,
        apiKey: settings.provider === 'searxng' ? '' : settings.apiKey,
        searchEngineId:
            settings.provider === 'google' ? settings.googleEngineId : '',
        endpoint:
            settings.provider === 'searxng' ? settings.searxngEndpoint : ''
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(
            response.status === 401 || response.status === 403
                ? 'The search engine refused the key.'
                : response.status === 429
                  ? 'The search engine says too many searches; try again later.'
                  : `The search engine answered with status ${response.status}.`
        );
    }
    let json: unknown;
    try {
        json = JSON.parse(response.data);
    } catch {
        throw new Error('The search engine did not answer with results.');
    }
    return parseCodeSearchResults(settings.provider, json);
}
