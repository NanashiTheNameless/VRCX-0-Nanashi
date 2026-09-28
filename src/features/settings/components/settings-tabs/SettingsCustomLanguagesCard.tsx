import {
    FolderOpenIcon,
    LanguagesIcon,
    RefreshCwIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type CustomLocaleEntry } from '@/platform/tauri/bindings';
import {
    deleteCustomLocale,
    loadCustomLocales,
    translateUiToCustomLocale,
    type UiTranslationProgress,
    type UiTranslationProvider
} from '@/services/customLocaleService';
import { setAppLanguagePreference } from '@/services/preferencesService';
import { toast } from '@/services/toastService';
import { useLlmEndpointsStore } from '@/state/llmEndpointsStore';
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
    const [locales, setLocales] = useState<CustomLocaleEntry[]>([]);
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [providerKind, setProviderKind] = useState<ProviderKind>('ai');
    const [endpointId, setEndpointId] = useState('');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [retranslate, setRetranslate] = useState(false);
    const [progress, setProgress] = useState<UiTranslationProgress | null>(
        null
    );
    const abortRef = useRef<AbortController | null>(null);
    const running = abortRef.current !== null && progress !== null;

    async function reload() {
        setLocales(await loadCustomLocales());
    }

    useEffect(() => {
        void reload();
        loadEndpoints().catch(() => {});
    }, [loadEndpoints]);

    const endpoint = endpoints.find((entry) => entry.id === endpointId);
    const modelItems = (endpoint?.models ?? []).map((value) => ({
        value,
        label: value
    }));
    const endpointItems = endpoints.map((entry) => ({
        value: entry.id,
        label: entry.name
    }));
    const codeValid =
        /^[A-Za-z0-9-]{2,32}$/.test(code.trim()) && code.trim() !== 'en';
    const providerReady =
        providerKind === 'ai'
            ? Boolean(endpointId && model)
            : Boolean(apiKey.trim());

    async function start() {
        const provider: UiTranslationProvider =
            providerKind === 'ai'
                ? { kind: 'ai', endpointId, model }
                : { kind: providerKind, key: apiKey.trim() };
        const controller = new AbortController();
        abortRef.current = controller;
        setProgress({ done: 0, total: 0, failed: 0 });
        try {
            const entry = await translateUiToCustomLocale({
                code: code.trim(),
                name: name.trim() || code.trim(),
                targetLanguage: code.trim(),
                provider,
                retranslateExisting: retranslate,
                signal: controller.signal,
                onProgress: setProgress
            });
            await reload();
            toast.add({
                type: 'success',
                title: t('view.settings.custom_languages.translate_done', {
                    name: entry.name
                }),
                actionProps: {
                    children: t('view.settings.custom_languages.use_now'),
                    onClick: () => {
                        void setAppLanguagePreference(entry.code);
                    }
                }
            });
        } catch (error) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            abortRef.current = null;
            setProgress(null);
        }
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
            {locales.length ? (
                locales.map((entry) => (
                    <Field
                        key={entry.code}
                        label={`${entry.name} (${entry.code})`}
                    >
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    void setAppLanguagePreference(entry.code)
                                }
                            >
                                {t('view.settings.custom_languages.use_now')}
                            </Button>
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
                            placeholder="de"
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
                            onClick={() => abortRef.current?.abort()}
                        >
                            {t('view.settings.custom_languages.cancel')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        disabled={running || !codeValid || !providerReady}
                        onClick={() => void start()}
                    >
                        {t('view.settings.custom_languages.start')}
                    </Button>
                </div>
            </div>
        </SettingsCard>
    );
}
