import {
    fallbackLocaleMessages,
    getLanguageName,
    getLoadedLocaleMessages,
    registerCustomLocale,
    unregisterCustomLocale,
    type LocalizedStringTable
} from '@/localization/index';
import {
    commands,
    type CustomLocaleEntry,
    type TranslationOverrides
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';

import i18n from './i18nService';

// Fork: user language files live in `<data dir>/locales/<code>.json`. They are
// loaded at startup, before the saved UI language is resolved, so a custom
// locale can be selected like a built-in one. Missing keys fall back to English.

function registerEntry(entry: CustomLocaleEntry) {
    if (!isRecord(entry.messages)) {
        return;
    }
    const messages = entry.messages as LocalizedStringTable;
    registerCustomLocale(entry.code, entry.name, messages);
    if (i18n.isInitialized) {
        i18n.addResourceBundle(entry.code, 'translation', messages, true, true);
    }
}

export async function loadCustomLocales(): Promise<CustomLocaleEntry[]> {
    let entries: CustomLocaleEntry[];
    try {
        entries = await commands.appCustomLocalesList();
    } catch (error) {
        console.warn('Failed to load custom language files:', error);
        return [];
    }
    for (const entry of entries) {
        registerEntry(entry);
    }
    return entries;
}

export async function saveCustomLocale(
    code: string,
    messages: LocalizedStringTable
): Promise<CustomLocaleEntry> {
    const entry = await commands.appCustomLocaleSave(code, messages);
    registerEntry(entry);
    return entry;
}

export async function deleteCustomLocale(code: string): Promise<void> {
    await commands.appCustomLocaleDelete(code);
    unregisterCustomLocale(code);
    if (i18n.hasResourceBundle(code, 'translation')) {
        i18n.removeResourceBundle(code, 'translation');
    }
}

// ---------------------------------------------------------------------------
// Language file metadata. Besides the top-level `language` display name, a file
// keeps how it was generated under `_meta`, so resuming or filling in missing
// strings reuses the same settings. API keys are never written here: language
// files are meant to be shareable.

export const LOCALE_META_KEY = '_meta';
/** Written for AI-only fields in files made with DeepL or Google. */
export const LOCALE_META_NOT_APPLICABLE = 'N/A';

export type CustomLocaleMeta = {
    code?: string;
    provider?: 'ai' | 'deepl' | 'google';
    endpointId?: string;
    model?: string;
    aiInstructions?: string;
};

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' &&
        value.trim() &&
        value.trim() !== LOCALE_META_NOT_APPLICABLE
        ? value
        : undefined;
}

export function readLocaleMeta(messages: unknown): CustomLocaleMeta {
    const meta = isRecord(messages) ? messages[LOCALE_META_KEY] : undefined;
    if (!isRecord(meta)) {
        return {};
    }
    const provider = meta.provider;
    return {
        code: optionalString(meta.code),
        provider:
            provider === 'ai' || provider === 'deepl' || provider === 'google'
                ? provider
                : undefined,
        endpointId: optionalString(meta.endpointId),
        model: optionalString(meta.model),
        aiInstructions: optionalString(meta.aiInstructions)
    };
}

// Every field is always written so the file shows exactly how it was made.
export function localeMetaFor(
    code: string,
    provider: UiTranslationProvider
): Record<keyof CustomLocaleMeta, string> {
    if (provider.kind !== 'ai') {
        return {
            code,
            provider: provider.kind,
            endpointId: LOCALE_META_NOT_APPLICABLE,
            model: LOCALE_META_NOT_APPLICABLE,
            aiInstructions: LOCALE_META_NOT_APPLICABLE
        };
    }
    return {
        code,
        provider: 'ai',
        endpointId: provider.endpointId,
        model: provider.model,
        aiInstructions: provider.instructions?.trim() ?? ''
    };
}

/**
 * The UI language as a model should read it: "Klingon (tlh_aa)" rather than a
 * bare code, which means little for custom languages, plus that language
 * file's saved AI instructions.
 */
export function describeLanguageForModel(code: string): string {
    const name = getLanguageName(code);
    const label = name && name !== code ? `${name} (${code})` : code;
    const instructions = readLocaleMeta(
        getLoadedLocaleMessages(code)
    ).aiInstructions?.trim();
    return instructions
        ? `${label}. Language instructions: ${instructions}`
        : label;
}

// ---------------------------------------------------------------------------
// UI translation: English source -> new custom locale file.

export type UiTranslationProvider =
    | { kind: 'ai'; endpointId: string; model: string; instructions?: string }
    | { kind: 'deepl'; key: string }
    | { kind: 'google'; key: string };

export type UiTranslationProgress = {
    done: number;
    total: number;
    failed: number;
};

type SourceString = { path: string; text: string };

const PROTECTED_PATTERN = /\{[^{}\s]+\}|<[^<>]+>|https?:\/\/\S+/g;
const AI_BATCH_SIZE = 40;
const MT_CONCURRENCY = 4;
const SAVE_EVERY = 200;

const AI_BATCH_PROMPT = [
    'You translate user-interface strings for a desktop companion app for the game VRChat into {targetLang}.',
    'The user message is a JSON object that maps ids to English strings.',
    'Reply with only a JSON object that has exactly the same ids mapped to the translated strings.',
    'Keep every [[n]] token exactly as written, and keep product names (VRChat, VRCX, VRCX-0-Nanashi, Steam, Discord) unchanged.',
    "Use the target language's own punctuation and typographic conventions."
].join(' ');

export function flattenLocaleStrings(
    table: unknown,
    prefix = ''
): SourceString[] {
    if (!isRecord(table)) {
        return [];
    }
    const out: SourceString[] = [];
    for (const [key, value] of Object.entries(table)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            if (path !== 'language' && value.trim()) {
                out.push({ path, text: value });
            }
        } else if (path !== LOCALE_META_KEY) {
            out.push(...flattenLocaleStrings(value, path));
        }
    }
    return out;
}

/** English UI strings that `messages` has no translation for. */
export function countMissingLocaleStrings(messages: unknown): number {
    return flattenLocaleStrings(fallbackLocaleMessages).filter(
        (source) => typeof readPath(messages, source.path) !== 'string'
    ).length;
}

export function readPath(table: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (current, part) => (isRecord(current) ? current[part] : undefined),
            table
        );
}

export function writePath(
    table: Record<string, unknown>,
    path: string,
    value: string
) {
    const parts = path.split('.');
    let current: Record<string, unknown> = table;
    for (const part of parts.slice(0, -1)) {
        const next = current[part];
        if (!isRecord(next)) {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}

/** Swap placeholders, tags and URLs for `[[n]]` tokens so translators keep them. */
export function protectText(text: string): {
    masked: string;
    tokens: string[];
} {
    const tokens: string[] = [];
    const masked = text.replace(PROTECTED_PATTERN, (match) => {
        tokens.push(match);
        return `[[${tokens.length - 1}]]`;
    });
    return { masked, tokens };
}

/** Restore tokens; returns null when the translation lost or duplicated one. */
export function restoreText(
    translated: string,
    tokens: string[]
): string | null {
    for (let index = 0; index < tokens.length; index += 1) {
        const count = translated.split(`[[${index}]]`).length - 1;
        if (count !== 1) {
            return null;
        }
    }
    return translated.replace(/\[\[(\d+)\]\]/g, (match, index: string) => {
        const token = tokens[Number(index)];
        return token ?? match;
    });
}

/** The batch prompt, plus the user's language instructions when given. */
export function aiBatchPrompt(instructions?: string): string {
    const extra = instructions?.trim();
    return extra
        ? `${AI_BATCH_PROMPT}\nInstructions for the target language from the user: ${extra}`
        : AI_BATCH_PROMPT;
}

function overridesFor(provider: UiTranslationProvider): TranslationOverrides {
    if (provider.kind === 'ai') {
        return {
            enabled: true,
            apiType: 'openai',
            key: null,
            endpointId: provider.endpointId,
            model: provider.model,
            prompt: aiBatchPrompt(provider.instructions),
            reasoningEffort: null
        };
    }
    return {
        enabled: true,
        apiType: provider.kind,
        key: provider.key,
        endpointId: null,
        model: null,
        prompt: null,
        reasoningEffort: null
    };
}

function parseJsonReply(text: string): Record<string, unknown> | null {
    const trimmed = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function translateOne(
    text: string,
    targetLanguage: string,
    overrides: TranslationOverrides
): Promise<string | null> {
    const { masked, tokens } = protectText(text);
    const result = await commands.appTranslationTranslate({
        text: masked,
        targetLanguage,
        overrides
    });
    return restoreText(result.text, tokens);
}

export type TranslateUiOptions = {
    code: string;
    name: string;
    targetLanguage: string;
    provider: UiTranslationProvider;
    retranslateExisting: boolean;
    signal: AbortSignal;
    onProgress: (progress: UiTranslationProgress) => void;
};

/**
 * Translate every English UI string and write the result as a custom locale.
 * Resumable: strings already present in an existing file for `code` are kept
 * unless `retranslateExisting` is set. Progress is saved periodically, and a
 * string whose placeholders do not survive translation is left in English.
 */
export async function translateUiToCustomLocale(
    options: TranslateUiOptions
): Promise<CustomLocaleEntry> {
    const existing = (await commands.appCustomLocalesList()).find(
        (entry) => entry.code === options.code
    );
    const output: Record<string, unknown> = isRecord(existing?.messages)
        ? structuredClone(existing.messages)
        : {};
    output.language = options.name;
    output[LOCALE_META_KEY] = localeMetaFor(options.code, options.provider);

    const sources = flattenLocaleStrings(fallbackLocaleMessages).filter(
        (source) =>
            options.retranslateExisting ||
            typeof readPath(output, source.path) !== 'string'
    );
    const progress: UiTranslationProgress = {
        done: 0,
        total: sources.length,
        failed: 0
    };
    options.onProgress({ ...progress });
    const overrides = overridesFor(options.provider);
    let sinceSave = 0;

    const record = (path: string, value: string | null) => {
        if (value === null || !value.trim()) {
            progress.failed += 1;
        } else {
            writePath(output, path, value);
        }
        progress.done += 1;
        sinceSave += 1;
    };
    const maybeSave = async () => {
        if (sinceSave >= SAVE_EVERY) {
            sinceSave = 0;
            await saveCustomLocale(options.code, output);
        }
        options.onProgress({ ...progress });
    };

    if (options.provider.kind === 'ai') {
        for (let start = 0; start < sources.length; start += AI_BATCH_SIZE) {
            if (options.signal.aborted) {
                break;
            }
            const batch = sources.slice(start, start + AI_BATCH_SIZE);
            const masked = batch.map((source) => protectText(source.text));
            const request = Object.fromEntries(
                masked.map((item, index) => [String(index), item.masked])
            );
            let reply: Record<string, unknown> | null = null;
            try {
                const result = await commands.appTranslationTranslate({
                    text: JSON.stringify(request),
                    targetLanguage: options.targetLanguage,
                    overrides
                });
                reply = parseJsonReply(result.text);
            } catch (error) {
                console.warn('UI translation batch failed:', error);
            }
            batch.forEach((source, index) => {
                const translated = reply?.[String(index)];
                record(
                    source.path,
                    typeof translated === 'string'
                        ? restoreText(translated, masked[index].tokens)
                        : null
                );
            });
            await maybeSave();
        }
    } else {
        let next = 0;
        const worker = async () => {
            while (next < sources.length && !options.signal.aborted) {
                const source = sources[next];
                next += 1;
                let translated: string | null = null;
                try {
                    translated = await translateOne(
                        source.text,
                        options.targetLanguage,
                        overrides
                    );
                } catch (error) {
                    console.warn('UI string translation failed:', error);
                }
                record(source.path, translated);
                await maybeSave();
            }
        };
        await Promise.all(
            Array.from({ length: MT_CONCURRENCY }, () => worker())
        );
    }

    const entry = await saveCustomLocale(options.code, output);
    options.onProgress({ ...progress });
    return entry;
}
