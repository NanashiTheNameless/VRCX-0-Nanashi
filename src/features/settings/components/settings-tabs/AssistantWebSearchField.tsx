import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';

/**
 * Fork: lets the assistant use the connected AI service's own web search
 * (Anthropic, OpenAI Responses, Gemini, Vertex AI). Off by default.
 */
export function AssistantWebSearchField() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState<boolean | null>(null);

    useEffect(() => {
        let active = true;
        commands
            .appAssistantWebSearch()
            .then((value) => {
                if (active) setEnabled(value);
            })
            .catch(() => {
                if (active) setEnabled(false);
            });
        return () => {
            active = false;
        };
    }, []);

    return (
        <Field
            settingId="ai.assistant.web-search"
            label={t('view.settings.ai.web_search')}
            description={t('view.settings.ai.web_search_description')}
        >
            <Switch
                checked={enabled === true}
                disabled={enabled === null}
                onCheckedChange={(next) => {
                    commands
                        .appAssistantSetWebSearch(next)
                        .then(setEnabled)
                        .catch((error: unknown) =>
                            toast.add({
                                type: 'error',
                                title:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            })
                        );
                }}
            />
        </Field>
    );
}
