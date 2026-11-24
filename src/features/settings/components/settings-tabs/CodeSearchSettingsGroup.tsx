import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsCard } from '@/components/layout/SettingsCard';
import {
    CODE_SEARCH_LINK_ENGINES,
    isValidLinkTemplate,
    loadCodeSearchSettings,
    saveCodeSearchSetting,
    type CodeSearchSettings
} from '@/services/codeSearchService';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { Field } from '../SettingsField';

const P = 'view.settings.integrations.code_search';
const NONE = 'none';

const LINK_ENGINE_LABELS: Record<
    keyof typeof CODE_SEARCH_LINK_ENGINES,
    string
> = {
    duckduckgo: 'DuckDuckGo',
    google: 'Google',
    bing: 'Bing',
    brave: 'Brave Search',
    startpage: 'Startpage',
    ecosia: 'Ecosia'
};

function ChoiceField({
    id,
    value,
    items,
    onChange
}: {
    id: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <Select
            value={value || NONE}
            items={items}
            onValueChange={(next) => {
                if (typeof next === 'string') {
                    onChange(next === NONE ? '' : next);
                }
            }}
        >
            <SelectTrigger id={id} className="w-64">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

function TextSetting({
    id,
    value,
    secret = false,
    placeholder,
    onSave
}: {
    id: string;
    value: string;
    secret?: boolean;
    placeholder?: string;
    onSave: (value: string) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <div className="flex items-center gap-2">
            <Input
                id={id}
                type={secret ? 'password' : 'text'}
                value={draft}
                placeholder={placeholder}
                autoComplete="off"
                className="w-64 font-mono"
                onChange={(event) => setDraft(event.target.value)}
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.trim() === value}
                onClick={() => onSave(draft.trim())}
            >
                {t('common.actions.save')}
            </Button>
        </div>
    );
}

/** Fork: which search engine finds VRChat codes. None is chosen by default. */
export function CodeSearchSettingsGroup() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<CodeSearchSettings | null>(null);

    useEffect(() => {
        let active = true;
        loadCodeSearchSettings()
            .then((loaded) => {
                if (active) setSettings(loaded);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    async function save<K extends keyof CodeSearchSettings>(
        key: K,
        value: CodeSearchSettings[K]
    ) {
        try {
            await saveCodeSearchSetting(key, value);
            setSettings((current) =>
                current ? { ...current, [key]: value } : current
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        }
    }

    if (!settings) {
        return null;
    }
    const none = { value: NONE, label: t(`${P}.none`) };

    return (
        <SettingsCard
            cardId="integrations.code-search"
            title={t(`${P}.header`)}
            description={t(`${P}.description`)}
        >
            <Field
                settingId="integrations.code-search.link-engine"
                label={t(`${P}.link_engine`)}
                description={t(`${P}.link_engine_description`)}
                controlId="code-search-link-engine"
            >
                <ChoiceField
                    id="code-search-link-engine"
                    value={settings.linkEngine}
                    items={[
                        none,
                        ...Object.entries(LINK_ENGINE_LABELS).map(
                            ([value, label]) => ({ value, label })
                        ),
                        { value: 'custom', label: t(`${P}.custom`) }
                    ]}
                    onChange={(value) =>
                        void save(
                            'linkEngine',
                            value as CodeSearchSettings['linkEngine']
                        )
                    }
                />
            </Field>
            {settings.linkEngine === 'custom' ? (
                <Field
                    settingId="integrations.code-search.link-template"
                    label={t(`${P}.link_template`)}
                    description={t(`${P}.link_template_description`, {
                        query: '{query}'
                    })}
                    controlId="code-search-link-template"
                    error={
                        settings.linkTemplate &&
                        !isValidLinkTemplate(settings.linkTemplate)
                            ? t(`${P}.link_template_invalid`, {
                                  query: '{query}'
                              })
                            : undefined
                    }
                >
                    <TextSetting
                        id="code-search-link-template"
                        value={settings.linkTemplate}
                        placeholder="https://example.org/search?q={query}"
                        onSave={(value) => void save('linkTemplate', value)}
                    />
                </Field>
            ) : null}
            <Field
                settingId="integrations.code-search.provider"
                label={t(`${P}.provider`)}
                description={t(`${P}.provider_description`)}
                controlId="code-search-provider"
            >
                <ChoiceField
                    id="code-search-provider"
                    value={settings.provider}
                    items={[
                        none,
                        { value: 'brave', label: t(`${P}.provider_brave`) },
                        { value: 'google', label: t(`${P}.provider_google`) },
                        { value: 'searxng', label: t(`${P}.provider_searxng`) }
                    ]}
                    onChange={(value) =>
                        void save(
                            'provider',
                            value as CodeSearchSettings['provider']
                        )
                    }
                />
            </Field>
            {settings.provider === 'brave' || settings.provider === 'google' ? (
                <Field
                    settingId="integrations.code-search.api-key"
                    label={t(`${P}.api_key`)}
                    description={t(`${P}.api_key_description`)}
                    controlId="code-search-api-key"
                >
                    <TextSetting
                        id="code-search-api-key"
                        secret
                        value={settings.apiKey}
                        onSave={(value) => void save('apiKey', value)}
                    />
                </Field>
            ) : null}
            {settings.provider === 'google' ? (
                <Field
                    settingId="integrations.code-search.google-engine-id"
                    label={t(`${P}.google_engine_id`)}
                    description={t(`${P}.google_engine_id_description`)}
                    controlId="code-search-google-engine-id"
                >
                    <TextSetting
                        id="code-search-google-engine-id"
                        value={settings.googleEngineId}
                        onSave={(value) => void save('googleEngineId', value)}
                    />
                </Field>
            ) : null}
            {settings.provider === 'searxng' ? (
                <Field
                    settingId="integrations.code-search.searxng-endpoint"
                    label={t(`${P}.searxng_endpoint`)}
                    description={t(`${P}.searxng_endpoint_description`)}
                    controlId="code-search-searxng-endpoint"
                >
                    <TextSetting
                        id="code-search-searxng-endpoint"
                        value={settings.searxngEndpoint}
                        placeholder="https://searx.example.org"
                        onSave={(value) => void save('searxngEndpoint', value)}
                    />
                </Field>
            ) : null}
        </SettingsCard>
    );
}
