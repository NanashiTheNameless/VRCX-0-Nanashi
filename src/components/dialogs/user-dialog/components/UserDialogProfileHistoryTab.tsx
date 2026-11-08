import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCompactDateTime } from '@/lib/dateTime';
import {
    commands,
    type ProfileHistoryEntry,
    type ProfileHistoryField
} from '@/platform/tauri/bindings';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';

const T = 'dialog.user.profile_history';
const FIELDS: ProfileHistoryField[] = ['status', 'bio', 'pronouns'];

export function UserDialogProfileHistoryTab({
    active,
    userId,
    currentUserId
}: {
    active: boolean;
    userId: string;
    currentUserId: string | null;
}) {
    const { t } = useTranslation();
    usePreferencesStore((state) => state.dtTimeZone);
    const [field, setField] = useState<ProfileHistoryField | 'all'>('all');
    const [rows, setRows] = useState<ProfileHistoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [more, setMore] = useState(false);
    const [revision, setRevision] = useState(0);
    const request = useRef({ id: 0 });

    useEffect(() => {
        if (!active || !userId || !currentUserId) {
            setRows([]);
            setMore(false);
            setLoading(false);
            return;
        }
        const tracker = request.current;
        const id = ++tracker.id;
        setRows([]);
        setError('');
        setLoading(true);
        commands
            .appProfileHistoryQuery({
                userId,
                field: field === 'all' ? null : field,
                beforeAt: null,
                beforeId: null,
                beforeField: null
            })
            .then((value) => {
                if (tracker.id !== id) return;
                setRows(value);
                setMore(value.length === 200);
            })
            .catch((cause: unknown) => {
                if (tracker.id === id) setError(String(cause));
            })
            .finally(() => {
                if (tracker.id === id) setLoading(false);
            });
        return () => {
            tracker.id++;
        };
    }, [active, currentUserId, userId, field, revision]);

    async function loadMore() {
        const last = rows.at(-1);
        if (!last || loading) return;
        const tracker = request.current;
        const id = tracker.id;
        setLoading(true);
        setError('');
        try {
            const value = await commands.appProfileHistoryQuery({
                userId,
                field: field === 'all' ? null : field,
                beforeAt: last.createdAt,
                beforeId: last.id,
                beforeField: last.field
            });
            if (tracker.id !== id) return;
            setRows((current) => [...current, ...value]);
            setMore(value.length === 200);
        } catch (cause) {
            if (tracker.id === id) setError(String(cause));
        } finally {
            if (tracker.id === id) setLoading(false);
        }
    }

    return (
        <EntityDialogTabContent value="profile-history">
            <div className="flex items-center gap-3">
                <select
                    className="bg-background rounded-md border px-2 py-1 text-sm"
                    aria-label={t(`${T}.filter`)}
                    value={field}
                    onChange={(event) =>
                        setField(
                            event.target.value as ProfileHistoryField | 'all'
                        )
                    }
                >
                    <option value="all">{t(`${T}.all`)}</option>
                    {FIELDS.map((entry) => (
                        <option key={entry} value={entry}>
                            {t(`view.settings.social.profile_history.${entry}`)}
                        </option>
                    ))}
                </select>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setRevision((value) => value + 1)}
                >
                    {t(`${T}.refresh`)}
                </Button>
            </div>
            <p className="text-muted-foreground text-sm">
                {t(`${T}.description`)}
            </p>
            {error ? (
                <p role="alert" className="text-destructive text-sm">
                    {error}
                </p>
            ) : null}
            {!loading && !error && rows.length === 0 ? (
                <p className="text-muted-foreground py-8 text-sm">
                    {t(`${T}.empty`)}
                </p>
            ) : null}
            <div className="space-y-3">
                {rows.map((row) => (
                    <article
                        key={`${row.field}:${row.id}`}
                        className="space-y-2 rounded-md border p-3 text-sm"
                    >
                        <div className="flex flex-wrap justify-between gap-2">
                            <span className="font-medium">
                                {t(
                                    `${T}.${row.property === 'statusDescription' ? 'status_text' : row.field}`
                                )}
                            </span>
                            <time className="text-muted-foreground tabular-nums">
                                {formatCompactDateTime(row.createdAt)}
                            </time>
                        </div>
                        {row.previousValue === row.value ? (
                            <div>
                                <p className="text-muted-foreground text-xs">
                                    {t(`${T}.snapshot`)}
                                </p>
                                <p className="break-words whitespace-pre-wrap">
                                    {row.value || t(`${T}.blank`)}
                                </p>
                            </div>
                        ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                                <div>
                                    <p className="text-muted-foreground text-xs">
                                        {t(`${T}.before`)}
                                    </p>
                                    <p className="break-words whitespace-pre-wrap">
                                        {row.previousValue || t(`${T}.blank`)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground text-xs">
                                        {t(`${T}.after`)}
                                    </p>
                                    <p className="break-words whitespace-pre-wrap">
                                        {row.value || t(`${T}.blank`)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </article>
                ))}
            </div>
            {loading ? <Spinner aria-label={t(`${T}.loading`)} /> : null}
            {more ? (
                <Button
                    variant="outline"
                    disabled={loading}
                    onClick={() => {
                        void loadMore();
                    }}
                >
                    {t(`${T}.more`)}
                </Button>
            ) : null}
        </EntityDialogTabContent>
    );
}
