import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { TranslationAction } from '@/components/translation/TranslationAction';
import { TranslationMeta } from '@/components/translation/TranslationMeta';
import { translationErrorI18nKey } from '@/components/translation/types';
import {
    useTextTranslation,
    type TranslatedEntry
} from '@/components/translation/useTextTranslation';
import { cn } from '@/lib/utils';
import { getLanguageName } from '@/localization/index';
import { usePreferencesStore } from '@/state/preferencesStore';

const notificationTranslationCache = new Map<string, TranslatedEntry>();

export function NotificationText({
    notificationId,
    translatable,
    revealActionOnHover = false,
    headline = '',
    message,
    accessory,
    children
}: {
    notificationId?: string;
    translatable: boolean;
    revealActionOnHover?: boolean;
    headline?: string;
    message: string;
    accessory?: ReactNode;
    children: (content: {
        headline: string;
        message: string;
        isTranslated: boolean;
    }) => ReactNode;
}) {
    const { t } = useTranslation();
    const translationEnabled = usePreferencesStore(
        (state) => state.translationAPI
    );
    const targetLanguage = usePreferencesStore((state) => state.bioLanguage);
    const canOfferTranslation = translatable && translationEnabled;
    const entityPrefix = `notification:${targetLanguage}:${notificationId || ''}`;
    const titleTranslation = useTextTranslation({
        source: canOfferTranslation ? headline : '',
        entityId: `${entityPrefix}:headline`,
        cache: notificationTranslationCache
    });
    const bodyTranslation = useTextTranslation({
        source: canOfferTranslation && message !== headline ? message : '',
        entityId: `${entityPrefix}:message`,
        cache: notificationTranslationCache
    });
    const translations = [titleTranslation, bodyTranslation];
    const canTranslate = translations.some((part) => part.canTranslate);
    const isTranslated =
        canTranslate &&
        translations.every((part) => !part.canTranslate || part.isTranslated);
    const isLoading = translations.some((part) => part.status === 'loading');
    const errorKind = titleTranslation.errorKind || bodyTranslation.errorKind;
    const meta = titleTranslation.isTranslated
        ? titleTranslation
        : bodyTranslation;

    const content = children({
        headline: isTranslated ? titleTranslation.visibleText : headline,
        message: isTranslated ? bodyTranslation.visibleText : message,
        isTranslated
    });

    if (!headline.trim() && !message.trim()) {
        return (
            <>
                {content}
                {accessory}
            </>
        );
    }

    return (
        <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                {isTranslated ? (
                    <TranslationMeta
                        detectedLang={meta.detectedLang}
                        targetLangLabel={getLanguageName(meta.targetLang)}
                    />
                ) : null}
                {content}
                {errorKind ? (
                    <p className="text-destructive mt-1 text-xs">
                        {t(translationErrorI18nKey(errorKind))}
                    </p>
                ) : null}
            </div>
            {accessory}
            <div
                className={cn(
                    'shrink-0 transition-opacity',
                    revealActionOnHover &&
                        !isTranslated &&
                        !isLoading &&
                        !errorKind &&
                        'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                )}
            >
                <TranslationAction
                    density="icon"
                    status={
                        isLoading
                            ? 'loading'
                            : errorKind
                              ? 'error'
                              : isTranslated
                                ? 'translated'
                                : 'idle'
                    }
                    isTranslated={isTranslated}
                    canTranslate={canTranslate}
                    onTranslate={() => {
                        void Promise.all(
                            translations.map((part) => part.translate())
                        );
                    }}
                    onShowOriginal={() =>
                        translations.forEach((part) => part.showOriginal())
                    }
                />
            </div>
        </div>
    );
}
