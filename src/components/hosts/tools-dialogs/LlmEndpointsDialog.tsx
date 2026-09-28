import {
    AlertTriangleIcon,
    PlusIcon,
    RefreshCwIcon,
    SquarePenIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    type LlmEndpointDetectModelsResult,
    type LlmEndpointDto,
    type LlmModelReasoning
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { mergeModels, useLlmEndpointsStore } from '@/state/llmEndpointsStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Combobox,
    ComboboxChip,
    ComboboxChips,
    ComboboxChipsInput,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxItem,
    ComboboxList,
    ComboboxValue,
    useComboboxAnchor
} from '@/ui/shadcn/combobox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
    LLM_API_KINDS,
    LLM_ENDPOINT_PROVIDER_PRESETS,
    applyLlmEndpointBaseUrl,
    applyLlmEndpointProviderPreset,
    createEmptyLlmEndpointDraft,
    findLlmEndpointProviderId,
    formatLlmHeaders,
    isLlmApiKind,
    isLlmEndpointProviderId,
    parseLlmHeaders,
    shouldUseSavedLlmEndpointForDetect,
    type LlmEndpointProviderDraft
} from './llmEndpointPresets';

type EndpointDraft = LlmEndpointProviderDraft;
type ResolvedModelsForSave = {
    models: string[];
    modelReasoning: LlmModelReasoning[] | null;
};

function draftFromEndpoint(endpoint: LlmEndpointDto): EndpointDraft {
    return {
        id: endpoint.id,
        savedBaseUrl: endpoint.baseUrl,
        providerId: findLlmEndpointProviderId(endpoint.baseUrl, endpoint.name),
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        clearKey: false,
        models: endpoint.models,
        detectedModelReasoning: null,
        apiKind: endpoint.apiKind ?? 'openaiCompatible',
        savedApiKind: endpoint.apiKind ?? 'openaiCompatible',
        headersText: formatLlmHeaders(endpoint.headers ?? []),
        savedHeadersText: formatLlmHeaders(endpoint.headers ?? [])
    };
}

function formatModelSummary(models: string[]): string {
    if (models.length <= 3) {
        return models.join(', ');
    }
    return `${models.slice(0, 3).join(', ')} +${models.length - 3}`;
}

function isValidBaseUrl(value: string): boolean {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    return url.protocol === 'http:' || url.protocol === 'https:';
}

function endpointApiKeyInput(draft: EndpointDraft): string | null {
    const apiKey = draft.apiKey.trim();
    if (!draft.id) {
        return apiKey;
    }
    if (draft.clearKey) {
        return '';
    }
    return apiKey || null;
}

function sameDetectionTarget(
    current: EndpointDraft,
    requested: EndpointDraft
): boolean {
    return (
        current.id === requested.id &&
        current.baseUrl.trim() === requested.baseUrl.trim() &&
        current.apiKey.trim() === requested.apiKey.trim() &&
        current.clearKey === requested.clearKey &&
        current.apiKind === requested.apiKind &&
        current.headersText === requested.headersText
    );
}

type LlmEndpointsDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function LlmEndpointsDialog({
    open,
    onOpenChange
}: LlmEndpointsDialogProps) {
    const { t } = useTranslation();
    const endpoints = useLlmEndpointsStore((state) => state.endpoints);
    const loading = useLlmEndpointsStore((state) => state.loading);
    const load = useLlmEndpointsStore((state) => state.load);
    const upsert = useLlmEndpointsStore((state) => state.upsert);
    const deleteEndpoint = useLlmEndpointsStore(
        (state) => state.deleteEndpoint
    );
    const detectModels = useLlmEndpointsStore((state) => state.detectModels);
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [draft, setDraft] = useState<EndpointDraft>(
        createEmptyLlmEndpointDraft
    );
    const draftRef = useRef(draft);
    draftRef.current = draft;
    const [detectedModels, setDetectedModels] = useState<string[]>([]);
    const [modelQuery, setModelQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const modelsAnchor = useComboboxAnchor();
    const baseUrlValid = isValidBaseUrl(draft.baseUrl);
    const modelOptions = mergeModels(detectedModels, draft.models);
    const providerOptions = [
        {
            value: CUSTOM_LLM_ENDPOINT_PROVIDER_ID,
            label: t('view.tools.llm_endpoints.preset_custom')
        },
        ...LLM_ENDPOINT_PROVIDER_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.labelKey ? t(preset.labelKey) : preset.label
        }))
    ];

    useEffect(() => {
        if (!open) {
            return;
        }
        setView('list');
        load().catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.load_failed')
            });
        });
    }, [open, load, t]);

    function dialogTitle(): string {
        if (view === 'list') {
            return t('view.tools.llm_endpoints.title');
        }
        return draft.id
            ? t('view.tools.llm_endpoints.edit')
            : t('view.tools.llm_endpoints.add');
    }

    function openAddView() {
        setDraft(createEmptyLlmEndpointDraft());
        setDetectedModels([]);
        setModelQuery('');
        setView('edit');
    }

    function openEditView(endpoint: LlmEndpointDto) {
        setDraft(draftFromEndpoint(endpoint));
        setDetectedModels([]);
        setModelQuery('');
        setView('edit');
    }

    function updateDraftProvider(value: string | null) {
        if (!isLlmEndpointProviderId(value)) {
            return;
        }
        setDraft((current) => applyLlmEndpointProviderPreset(current, value));
        setDetectedModels([]);
    }

    async function detectInto(
        target: EndpointDraft
    ): Promise<LlmEndpointDetectModelsResult | null> {
        const useSavedEndpoint = shouldUseSavedLlmEndpointForDetect(target);
        const result = await detectModels({
            id: useSavedEndpoint ? target.id : null,
            baseUrl: useSavedEndpoint ? null : target.baseUrl.trim() || null,
            apiKey: useSavedEndpoint ? null : target.apiKey.trim() || null,
            persist: useSavedEndpoint,
            apiKind: useSavedEndpoint ? null : target.apiKind,
            headers: useSavedEndpoint
                ? null
                : parseLlmHeaders(target.headersText)
        });
        if (!sameDetectionTarget(draftRef.current, target)) {
            return null;
        }
        setDetectedModels(result.models);
        setDraft((current) =>
            sameDetectionTarget(current, target)
                ? {
                      ...current,
                      detectedModelReasoning: result.modelReasoning
                  }
                : current
        );
        return result;
    }

    async function detectForDraft() {
        try {
            const result = await detectInto(draft);
            if (!result) {
                return;
            }
            setDraft((current) =>
                sameDetectionTarget(current, draft)
                    ? {
                          ...current,
                          models: mergeModels(current.models, result.models)
                      }
                    : current
            );
            toast.add({
                type: 'success',
                title: result.models.length
                    ? t('view.tools.llm_endpoints.models_detected', {
                          count: result.models.length
                      })
                    : t('view.tools.llm_endpoints.no_models_detected')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.detect_failed')
            });
        }
    }

    async function resolveModelsForSave(
        target: EndpointDraft
    ): Promise<ResolvedModelsForSave | null> {
        if (target.models.length) {
            return {
                models: target.models,
                modelReasoning: target.detectedModelReasoning
            };
        }
        try {
            return await detectInto(target);
        } catch {
            return {
                models: [],
                modelReasoning: null
            };
        }
    }

    async function saveDraft() {
        const target = draft;
        setSaving(true);
        try {
            const resolved = await resolveModelsForSave(target);
            if (!resolved) {
                return;
            }
            const { models, modelReasoning } = resolved;
            await upsert({
                id: target.id,
                name: target.name.trim(),
                baseUrl: target.baseUrl.trim(),
                apiKey: endpointApiKeyInput(target),
                models,
                modelReasoning,
                apiKind: target.apiKind,
                headers: parseLlmHeaders(target.headersText)
            });
            if (models.length) {
                toast.add({
                    type: 'success',
                    title: t('view.tools.llm_endpoints.saved')
                });
            } else {
                toast.add({
                    type: 'warning',
                    title: t('view.tools.llm_endpoints.saved_unusable')
                });
            }
            setView('list');
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.save_failed')
            });
        } finally {
            setSaving(false);
        }
    }

    function addQueriedModel(event: React.KeyboardEvent<HTMLInputElement>) {
        const model = modelQuery.trim();
        if (event.key !== 'Enter' || !model || modelOptions.includes(model)) {
            return;
        }
        event.preventDefault();
        setDraft((current) => ({
            ...current,
            models: mergeModels(current.models, [model])
        }));
        setModelQuery('');
    }

    function detectForRow(endpoint: LlmEndpointDto) {
        detectModels({
            id: endpoint.id,
            baseUrl: null,
            apiKey: null,
            persist: true,
            apiKind: null,
            headers: null
        }).catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.detect_failed')
            });
        });
    }

    async function deleteEndpointWithFeedback(endpoint: LlmEndpointDto) {
        try {
            await deleteEndpoint(endpoint.id);
            toast.add({
                type: 'success',
                title: t('view.tools.llm_endpoints.deleted')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.llm_endpoints.delete_failed')
            });
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    'max-h-[85vh] overflow-y-auto',
                    view === 'edit' ? 'sm:max-w-lg' : 'sm:max-w-3xl'
                )}
            >
                <DialogHeader>
                    <DialogTitle>{dialogTitle()}</DialogTitle>
                    {view === 'list' ? (
                        <DialogDescription>
                            {t('view.tools.llm_endpoints.description')}
                        </DialogDescription>
                    ) : null}
                </DialogHeader>

                {view === 'list' ? (
                    <div className="grid gap-2">
                        {endpoints.length ? (
                            <>
                                {endpoints.map((endpoint) => (
                                    <EndpointRow
                                        key={endpoint.id}
                                        endpoint={endpoint}
                                        disabled={loading}
                                        onDetect={() => detectForRow(endpoint)}
                                        onEdit={() => openEditView(endpoint)}
                                        onDelete={() =>
                                            deleteEndpointWithFeedback(endpoint)
                                        }
                                    />
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="justify-self-start"
                                    onClick={openAddView}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.tools.llm_endpoints.add')}
                                </Button>
                            </>
                        ) : (
                            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-8 text-center">
                                <span className="text-muted-foreground text-sm">
                                    {t(
                                        'view.tools.llm_endpoints.empty_description'
                                    )}
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={openAddView}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {t('view.tools.llm_endpoints.add')}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-preset">
                                {t('view.tools.llm_endpoints.preset')}
                            </Label>
                            <Select
                                value={draft.providerId}
                                items={providerOptions}
                                onValueChange={updateDraftProvider}
                            >
                                <SelectTrigger
                                    id="llm-endpoint-dialog-preset"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {providerOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-api-kind">
                                {t('view.tools.llm_endpoints.api_kind')}
                            </Label>
                            <Select
                                value={draft.apiKind}
                                items={LLM_API_KINDS}
                                onValueChange={(value) => {
                                    if (!isLlmApiKind(value)) {
                                        return;
                                    }
                                    setDraft((current) => ({
                                        ...current,
                                        apiKind: value,
                                        detectedModelReasoning: null
                                    }));
                                    setDetectedModels([]);
                                }}
                            >
                                <SelectTrigger
                                    id="llm-endpoint-dialog-api-kind"
                                    className="w-full"
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {LLM_API_KINDS.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    'view.tools.llm_endpoints.api_kind_description'
                                )}
                            </span>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-name">
                                {t('view.tools.llm_endpoints.name')}
                            </Label>
                            <Input
                                id="llm-endpoint-dialog-name"
                                value={draft.name}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        name: event.target.value,
                                        providerId: findLlmEndpointProviderId(
                                            current.baseUrl,
                                            event.target.value
                                        )
                                    }))
                                }
                            />
                            <span className="text-muted-foreground text-xs">
                                {t('view.tools.llm_endpoints.name_description')}
                            </span>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-base-url">
                                {t('view.tools.llm_endpoints.base_url')}
                            </Label>
                            <Input
                                id="llm-endpoint-dialog-base-url"
                                value={draft.baseUrl}
                                aria-invalid={
                                    Boolean(draft.baseUrl) && !baseUrlValid
                                }
                                placeholder="https://api.openai.com/v1"
                                onChange={(event) =>
                                    setDraft((current) =>
                                        applyLlmEndpointBaseUrl(
                                            current,
                                            event.target.value
                                        )
                                    )
                                }
                            />
                            {draft.baseUrl && !baseUrlValid ? (
                                <span className="text-destructive text-xs">
                                    {t(
                                        'view.tools.llm_endpoints.base_url_invalid'
                                    )}
                                </span>
                            ) : null}
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label htmlFor="llm-endpoint-dialog-api-key">
                                    {t('view.tools.llm_endpoints.api_key')}
                                </Label>
                                {draft.id ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            draft.clearKey
                                                ? 'secondary'
                                                : 'outline'
                                        }
                                        onClick={() =>
                                            setDraft((current) => ({
                                                ...current,
                                                clearKey: !current.clearKey
                                            }))
                                        }
                                    >
                                        {t(
                                            'view.tools.llm_endpoints.clear_key'
                                        )}
                                    </Button>
                                ) : null}
                            </div>
                            <Input
                                id="llm-endpoint-dialog-api-key"
                                type="text"
                                value={draft.apiKey}
                                disabled={draft.clearKey}
                                placeholder={
                                    draft.id
                                        ? t(
                                              'view.tools.llm_endpoints.key_preserve_placeholder'
                                          )
                                        : 'sk-...'
                                }
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        apiKey: event.target.value
                                    }))
                                }
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="llm-endpoint-dialog-headers">
                                {t('view.tools.llm_endpoints.headers')}
                            </Label>
                            <Textarea
                                id="llm-endpoint-dialog-headers"
                                value={draft.headersText}
                                rows={2}
                                placeholder="X-Custom-Header: value"
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        headersText: event.target.value
                                    }))
                                }
                            />
                            <span className="text-muted-foreground text-xs">
                                {t(
                                    'view.tools.llm_endpoints.headers_description'
                                )}
                            </span>
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label>
                                    {t('view.tools.llm_endpoints.models')}
                                </Label>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={loading || !baseUrlValid}
                                    onClick={detectForDraft}
                                >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    {t(
                                        'view.tools.llm_endpoints.detect_models'
                                    )}
                                </Button>
                            </div>
                            <Combobox
                                multiple
                                autoHighlight
                                items={modelOptions}
                                value={draft.models}
                                inputValue={modelQuery}
                                onInputValueChange={setModelQuery}
                                onValueChange={(models: string[]) =>
                                    setDraft((current) => ({
                                        ...current,
                                        models
                                    }))
                                }
                            >
                                <ComboboxChips
                                    ref={modelsAnchor}
                                    className="w-full"
                                >
                                    <ComboboxValue>
                                        {(models: string[]) => (
                                            <>
                                                {models.map((model) => (
                                                    <ComboboxChip key={model}>
                                                        <span className="max-w-48 truncate">
                                                            {model}
                                                        </span>
                                                    </ComboboxChip>
                                                ))}
                                                <ComboboxChipsInput
                                                    placeholder={
                                                        models.length
                                                            ? ''
                                                            : t(
                                                                  'view.tools.llm_endpoints.models_placeholder'
                                                              )
                                                    }
                                                    onKeyDown={addQueriedModel}
                                                />
                                            </>
                                        )}
                                    </ComboboxValue>
                                </ComboboxChips>
                                <ComboboxContent anchor={modelsAnchor}>
                                    <ComboboxEmpty>
                                        {t(
                                            'view.tools.llm_endpoints.models_empty'
                                        )}
                                    </ComboboxEmpty>
                                    <ComboboxList>
                                        {(model: string) => (
                                            <ComboboxItem
                                                key={model}
                                                value={model}
                                            >
                                                {model}
                                            </ComboboxItem>
                                        )}
                                    </ComboboxList>
                                </ComboboxContent>
                            </Combobox>
                        </div>
                    </div>
                )}

                {view === 'edit' ? (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setView('list')}
                        >
                            {t('common.actions.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={loading || saving || !baseUrlValid}
                            onClick={saveDraft}
                        >
                            {t('common.actions.save')}
                        </Button>
                    </DialogFooter>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

type EndpointRowProps = {
    endpoint: LlmEndpointDto;
    disabled: boolean;
    onDetect: () => void;
    onEdit: () => void;
    onDelete: () => void;
};

function EndpointRow({
    endpoint,
    disabled,
    onDetect,
    onEdit,
    onDelete
}: EndpointRowProps) {
    const { t } = useTranslation();
    const unusable = !endpoint.models.length;

    return (
        <div
            className={cn(
                'grid gap-2 rounded-md border px-3 py-2.5',
                unusable && 'border-destructive/40'
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="grid min-w-0 gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">
                            {endpoint.name}
                        </span>
                        <Badge
                            variant={endpoint.hasKey ? 'secondary' : 'outline'}
                        >
                            {endpoint.hasKey
                                ? t('view.tools.llm_endpoints.key_saved')
                                : t('view.tools.llm_endpoints.key_empty')}
                        </Badge>
                    </div>
                    <span className="text-muted-foreground truncate text-xs">
                        {endpoint.baseUrl}
                    </span>
                    {unusable ? null : (
                        <span className="text-muted-foreground truncate text-xs">
                            {formatModelSummary(endpoint.models)}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 gap-1">
                    <RowAction
                        label={t('view.tools.llm_endpoints.detect_models')}
                        disabled={disabled}
                        onClick={onDetect}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                    </RowAction>
                    <RowAction
                        label={t('view.tools.llm_endpoints.edit')}
                        disabled={disabled}
                        onClick={onEdit}
                    >
                        <SquarePenIcon data-icon="inline-start" />
                    </RowAction>
                    <RowAction
                        label={t('view.tools.llm_endpoints.delete')}
                        disabled={disabled}
                        onClick={onDelete}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </RowAction>
                </div>
            </div>
            {unusable ? (
                <div className="text-destructive flex flex-wrap items-center gap-2 text-xs">
                    <AlertTriangleIcon className="size-3.5" />
                    <span>{t('view.tools.llm_endpoints.unusable')}</span>
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={disabled}
                        onClick={onDetect}
                    >
                        {t('view.tools.llm_endpoints.detect_models')}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

type RowActionProps = {
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
};

function RowAction({ label, disabled, onClick, children }: RowActionProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={label}
                        disabled={disabled}
                        onClick={onClick}
                    />
                }
            >
                {children}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
