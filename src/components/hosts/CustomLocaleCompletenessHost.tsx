import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    FALLBACK_LOCALE_CODE,
    getLanguageName,
    getLoadedLocaleMessages
} from '@/localization/index';
import { countMissingLocaleStrings } from '@/services/customLocaleService';
import { toast } from '@/services/toastService';
import { useNavigationCacheStore } from '@/state/navigationCacheStore';
import { useShellStore } from '@/state/shellStore';
import { useUiTranslationJobStore } from '@/state/uiTranslationJobStore';

const CUSTOM_LANGUAGES_CARD_ID = 'interface.custom-languages';

// Fork: warn once per session when the active UI language is a custom file
// that lacks strings, and offer to generate them from the languages card.
export function CustomLocaleCompletenessHost() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const locale = useShellStore((state) => state.locale);
    const jobCode = useUiTranslationJobStore((state) => state.job?.code);
    const warned = useRef(new Set<string>());

    useEffect(() => {
        if (
            locale === FALLBACK_LOCALE_CODE ||
            locale === jobCode ||
            warned.current.has(locale)
        ) {
            return;
        }
        const messages = getLoadedLocaleMessages(locale);
        if (!messages) {
            return;
        }
        const missing = countMissingLocaleStrings(messages);
        if (missing === 0) {
            return;
        }
        warned.current.add(locale);
        toast.add({
            type: 'warning',
            title: t('view.settings.custom_languages.missing_toast_title', {
                name: getLanguageName(locale),
                count: missing
            }),
            description: t(
                'view.settings.custom_languages.missing_toast_description'
            ),
            actionProps: {
                children: t(
                    'view.settings.custom_languages.missing_toast_action'
                ),
                onClick: () => {
                    useNavigationCacheStore
                        .getState()
                        .setSettingsCardOpen(CUSTOM_LANGUAGES_CARD_ID, true);
                    navigate('/settings?tab=interface');
                }
            }
        });
    }, [locale, jobCode, navigate, t]);

    return null;
}
