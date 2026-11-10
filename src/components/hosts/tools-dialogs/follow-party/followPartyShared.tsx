import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import { publishToolsStatusUpdated } from '@/shared/constants/tools';
import {
    defaultEmojiName,
    defaultEmojiPreviewUrl
} from '@/shared/constants/vrchatDefaultEmojis';

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Loads one JSON config value while the dialog is open and saves changes in
 * order, so quick edits never overwrite each other out of order.
 */
export function useJsonConfigValue<T>(
    key: string,
    open: boolean,
    fallbackRaw: string,
    parse: (raw: unknown) => T
): {
    value: T;
    loading: boolean;
    save: (next: T) => Promise<void>;
} {
    const { t } = useTranslation();
    const parseRef = useRef(parse);
    parseRef.current = parse;
    const [value, setValue] = useState<T>(() => parse(parseJson(fallbackRaw)));
    const [loading, setLoading] = useState(false);
    const queue = useRef<Promise<void>>(Promise.resolve());

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        setLoading(true);
        configRepository
            .getString(key, fallbackRaw)
            .then((raw) => {
                if (active) {
                    setValue(parseRef.current(parseJson(raw)));
                }
            })
            .catch((error: unknown) =>
                toast.add({
                    type: 'error',
                    title: userFacingErrorMessage(
                        error,
                        t('view.tools.follow_party.failed_to_load')
                    )
                })
            )
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [open, key, fallbackRaw, t]);

    const save = useCallback(
        (next: T) => {
            setValue(next);
            const write = queue.current
                .catch(() => {})
                .then(() =>
                    configRepository.setString(key, JSON.stringify(next))
                )
                .then(() => publishToolsStatusUpdated())
                .catch((error: unknown) => {
                    toast.add({
                        type: 'error',
                        title: userFacingErrorMessage(
                            error,
                            t('view.tools.follow_party.failed_to_save')
                        )
                    });
                });
            queue.current = write;
            return write;
        },
        [key, t]
    );

    return { value, loading, save };
}

export function ConsentEmojiBadge({ emojiId }: { emojiId: string }) {
    const previewUrl = defaultEmojiPreviewUrl(emojiId);
    return (
        <span className="bg-muted inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium">
            {previewUrl ? (
                <img
                    src={previewUrl}
                    alt=""
                    className="size-6"
                    referrerPolicy="no-referrer"
                />
            ) : null}
            {defaultEmojiName(emojiId)}
        </span>
    );
}
