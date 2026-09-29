import {
    FolderOpenIcon,
    LanguagesIcon,
    TriangleAlertIcon,
    RefreshCwIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FALLBACK_LOCALE_CODE, getLanguageName } from '@/localization/index';
import { commands, type CustomLocaleEntry } from '@/platform/tauri/bindings';
import {
    countMissingLocaleStrings,
    deleteCustomLocale,
    loadCustomLocales,
    readLocaleMeta,
    type CustomLocaleMeta,
    type UiTranslationProvider
} from '@/services/customLocaleService';
import { setAppLanguagePreference } from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { useShellStore } from '@/state/shellStore';
import { useUiTranslationJobStore } from '@/state/uiTranslationJobStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Progress } from '@/ui/shadcn/progress';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

type ProviderKind = UiTranslationProvider['kind'];

const PROVIDER_ITEMS: { value: ProviderKind; label: string }[] = [
    { value: 'ai', label: 'AI endpoint' },
    { value: 'deepl', label: 'DeepL API key' },
    { value: 'google', label: 'Google Translate API key' }
];

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Fork: manage user language files and translate the UI into new ones.
export function SettingsCustomLanguagesCard() {
    const { t } = useTranslation();
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const loadEndpoints = useLlmEndpointsStore((state) => state.load);
    const activeLocale = useShellStore((state) => state.locale);
    const [locales, setLocales] = useState<CustomLocaleEntry[]>([]);
    const missingByCode = useMemo(
        () =>
            new Map(
                locales.map((entry) => [
                    entry.code,
                    countMissingLocaleStrings(entry.messages)
                ])
            ),
        [locales]
    );
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [aiInstructions, setAiInstructions] = useState('');
    const [providerKind, setProviderKind] = useState<ProviderKind>('ai');
    const [endpointId, setEndpointId] = useState('');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [retranslate, setRetranslate] = useState(false);
    const job = useUiTranslationJobStore((state) => state.job);
    const startJob = useUiTranslationJobStore((state) => state.start);
    const cancelJob = useUiTranslationJobStore((state) => state.cancel);
    const progress = job?.progress ?? null;
    const running = job !== null;

    async function reload() {
        setLocales(await loadCustomLocales());
    }

    useEffect(() => {
        loadEndpoints().catch(() => {});
    }, [loadEndpoints]);

    // Load on mount, and pick up the file a background job wrote once it ends.
    useEffect(() => {
        if (!running) {
            void reload();
        }
    }, [running]);

    const endpoint = endpoints.find((entry) => entry.id === endpointId);

    // Fork: default to the first endpoint (and its first model) while none,
    // or a deleted one, is selected; the user can still pick another.
    const firstEndpoint = endpoints[0];
    if (providerKind === 'ai' && firstEndpoint && !endpoint) {
        setEndpointId(firstEndpoint.id);
        setModel(firstEndpoint.models[0] ?? '');
    }
    const modelItems = (endpoint?.models ?? []).map((value) => ({
        value,
        label: value
    }));
    const endpointItems = endpoints.map((entry) => ({
        value: entry.id,
        label: entry.name
    }));
    const codeValid =
        /^[A-Za-z0-9_-]{2,32}$/.test(code.trim()) && code.trim() !== 'en';
    const providerReady =
        providerKind === 'ai'
            ? Boolean(endpointId && model)
            : Boolean(apiKey.trim());

    function formProvider(): UiTranslationProvider {
        return providerKind === 'ai'
            ? { kind: 'ai', endpointId, model, instructions: aiInstructions }
            : { kind: providerKind, key: apiKey.trim() };
    }

    function start(
        provider: UiTranslationProvider = formProvider(),
        targetCode = code.trim(),
        targetName = name.trim(),
        retranslateExisting = retranslate
    ) {
        startJob({
            code: targetCode,
            name: targetName || targetCode,
            // Non-standard codes (en_pt, qes, tlh_aa, ...) mean little to a
            // model on their own, so AI providers also get the display name.
            targetLanguage:
                provider.kind === 'ai' && targetName
                    ? `${targetName} (${targetCode})`
                    : targetCode,
            provider,
            retranslateExisting
        });
    }

    // Load a language file's saved name and generation settings into the form.
    function prefill(entry: CustomLocaleEntry) {
        const meta = readLocaleMeta(entry.messages);
        setPrefilledCode(entry.code);
        setCode(entry.code);
        setName(entry.name);
        setAiInstructions(meta.aiInstructions ?? '');
        if (meta.provider) {
            setProviderKind(meta.provider);
        }
        if (meta.provider === 'ai') {
            setEndpointId(meta.endpointId ?? '');
            setModel(meta.model ?? '');
        }
        return meta;
    }

    // Typing the code of an existing file loads its saved settings once.
    const matchedEntry = locales.find((entry) => entry.code === code.trim());
    const [prefilledCode, setPrefilledCode] = useState('');
    if (matchedEntry && matchedEntry.code !== prefilledCode) {
        setPrefilledCode(matchedEntry.code);
        prefill(matchedEntry);
    }

    // The provider a file was generated with, when it can be reused as is.
    // Keys are never saved in the file, so DeepL/Google need the form's key.
    function savedProvider(
        meta: CustomLocaleMeta
    ): UiTranslationProvider | null {
        if (meta.provider === 'ai') {
            const known = endpoints.some(
                (entry) => entry.id === meta.endpointId
            );
            return known && meta.endpointId && meta.model
                ? {
                      kind: 'ai',
                      endpointId: meta.endpointId,
                      model: meta.model,
                      instructions: meta.aiInstructions
                  }
                : null;
        }
        if (meta.provider && apiKey.trim()) {
            return { kind: meta.provider, key: apiKey.trim() };
        }
        return !meta.provider && providerReady ? formProvider() : null;
    }

    // Fill in only the strings the file lacks, with the settings it was made
    // with; asks for a provider first when those cannot be reused.
    function generateMissing(entry: CustomLocaleEntry) {
        const provider = savedProvider(prefill(entry));
        if (!provider) {
            toast.add({
                type: 'info',
                title: t(
                    'view.settings.custom_languages.generate_missing_needs_provider'
                )
            });
            return;
        }
        start(provider, entry.code, entry.name, false);
    }

    async function remove(entry: CustomLocaleEntry) {
        try {
            await deleteCustomLocale(entry.code);
            await reload();
        } catch (error) {
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    return (
        <SettingsCard
            cardId="interface.custom-languages"
            title={t('view.settings.custom_languages.header')}
            description={t('view.settings.custom_languages.description')}
            action={
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void reload()}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('view.settings.custom_languages.reload')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            void commands
                                .appCustomLocalesOpenFolder()
                                .catch((error: unknown) =>
                                    toast.add({
                                        type: 'error',
                                        title: errorMessage(error)
                                    })
                                )
                        }
                    >
                        <FolderOpenIcon data-icon="inline-start" />
                        {t('view.settings.custom_languages.open_folder')}
                    </Button>
                </div>
            }
        >
            <Field label={getLanguageName(FALLBACK_LOCALE_CODE)}>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={activeLocale === FALLBACK_LOCALE_CODE}
                    onClick={() =>
                        void setAppLanguagePreference(FALLBACK_LOCALE_CODE)
                    }
                >
                    {activeLocale === FALLBACK_LOCALE_CODE
                        ? t('view.settings.custom_languages.in_use')
                        : t('view.settings.custom_languages.use_now')}
                </Button>
            </Field>
            {locales.length ? (
                locales.map((entry) => (
                    <Field
                        key={entry.code}
                        label={entry.name}
                        description={entry.code}
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={activeLocale === entry.code}
                                onClick={() =>
                                    void setAppLanguagePreference(entry.code)
                                }
                            >
                                {activeLocale === entry.code
                                    ? t('view.settings.custom_languages.in_use')
                                    : t(
                                          'view.settings.custom_languages.use_now'
                                      )}
                            </Button>
                            {missingByCode.get(entry.code) ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={running}
                                    onClick={() => generateMissing(entry)}
                                >
                                    {t(
                                        'view.settings.custom_languages.generate_missing'
                                    )}
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={t(
                                    'view.settings.custom_languages.delete'
                                )}
                                onClick={() => void remove(entry)}
                            >
                                <Trash2Icon data-icon="icon" />
                            </Button>
                            {missingByCode.get(entry.code) ? (
                                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                                    <TriangleAlertIcon className="size-3.5 text-amber-700 dark:text-amber-400" />
                                    {t(
                                        'view.settings.custom_languages.missing_strings',
                                        { count: missingByCode.get(entry.code) }
                                    )}
                                </span>
                            ) : null}
                        </div>
                    </Field>
                ))
            ) : (
                <span className="text-muted-foreground text-sm">
                    {t('view.settings.custom_languages.empty')}
                </span>
            )}

            <div className="grid gap-3 border-t pt-3">
                <div className="flex items-center gap-2 font-medium">
                    <LanguagesIcon className="size-4" />
                    {t('view.settings.custom_languages.translate_header')}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="custom-language-code">
                            {t('view.settings.custom_languages.code')}
                        </Label>
                        <Input
                            id="custom-language-code"
                            value={code}
                            placeholder="de, en_pt, tlh_aa"
                            aria-invalid={Boolean(code) && !codeValid}
                            onChange={(event) => setCode(event.target.value)}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="custom-language-name">
                            {t('view.settings.custom_languages.name')}
                        </Label>
                        <Input
                            id="custom-language-name"
                            value={name}
                            placeholder="Deutsch"
                            onChange={(event) => setName(event.target.value)}
                        />
                    </div>
                    {providerKind === 'ai' ? (
                        <div className="grid gap-1.5 sm:col-span-2">
                            <Label htmlFor="custom-language-ai-instructions">
                                {t(
                                    'view.settings.custom_languages.ai_instructions'
                                )}
                            </Label>
                            <Textarea
                                id="custom-language-ai-instructions"
                                rows={3}
                                value={aiInstructions}
                                placeholder={t(
                                    'view.settings.custom_languages.ai_instructions_placeholder'
                                )}
                                onChange={(event) =>
                                    setAiInstructions(event.target.value)
                                }
                            />
                            <p className="text-muted-foreground text-xs">
                                {t(
                                    'view.settings.custom_languages.ai_instructions_description'
                                )}
                            </p>
                        </div>
                    ) : null}
                    <div className="grid gap-1.5">
                        <Label htmlFor="custom-language-provider">
                            {t('view.settings.custom_languages.provider')}
                        </Label>
                        <Select
                            value={providerKind}
                            items={PROVIDER_ITEMS}
                            onValueChange={(value) =>
                                setProviderKind((value ?? 'ai') as ProviderKind)
                            }
                        >
                            <SelectTrigger
                                id="custom-language-provider"
                                className="w-full"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {PROVIDER_ITEMS.map((item) => (
                                        <SelectItem
                                            key={item.value}
                                            value={item.value}
                                        >
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                    {providerKind === 'ai' ? (
                        <>
                            <div className="grid gap-1.5">
                                <Label htmlFor="custom-language-endpoint">
                                    {t(
                                        'view.settings.custom_languages.endpoint'
                                    )}
                                </Label>
                                <Select
                                    value={endpointId}
                                    items={endpointItems}
                                    onValueChange={(value) => {
                                        setEndpointId(value ?? '');
                                        setModel('');
                                    }}
                                >
                                    <SelectTrigger
                                        id="custom-language-endpoint"
                                        className="w-full"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {endpointItems.map((item) => (
                                                <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                >
                                                    {item.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="custom-language-model">
                                    {t('view.settings.custom_languages.model')}
                                </Label>
                                <Select
                                    value={model}
                                    items={modelItems}
                                    onValueChange={(value) =>
                                        setModel(value ?? '')
                                    }
                                >
                                    <SelectTrigger
                                        id="custom-language-model"
                                        className="w-full"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {modelItems.map((item) => (
                                                <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                >
                                                    {item.label}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    ) : (
                        <div className="grid gap-1.5">
                            <Label htmlFor="custom-language-key">
                                {t('view.settings.custom_languages.api_key')}
                            </Label>
                            <Input
                                id="custom-language-key"
                                type="password"
                                value={apiKey}
                                onChange={(event) =>
                                    setApiKey(event.target.value)
                                }
                            />
                        </div>
                    )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                        checked={retranslate}
                        onCheckedChange={(checked) =>
                            setRetranslate(checked === true)
                        }
                    />
                    {t('view.settings.custom_languages.retranslate')}
                </label>
                <span className="text-muted-foreground text-xs">
                    {t('view.settings.custom_languages.translate_description')}
                </span>
                {progress ? (
                    <div className="grid gap-1.5">
                        <Progress
                            value={
                                progress.total
                                    ? Math.round(
                                          (progress.done / progress.total) * 100
                                      )
                                    : 0
                            }
                        />
                        <span className="text-muted-foreground text-xs">
                            {t('view.settings.custom_languages.progress', {
                                done: progress.done,
                                total: progress.total,
                                failed: progress.failed
                            })}
                        </span>
                    </div>
                ) : null}
                <div className="flex justify-end gap-2">
                    {running ? (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={cancelJob}
                        >
                            {t('view.settings.custom_languages.cancel')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        disabled={running || !codeValid || !providerReady}
                        onClick={() => start()}
                    >
                        {t('view.settings.custom_languages.start')}
                    </Button>
                </div>
            </div>
        </SettingsCard>
    );
}
