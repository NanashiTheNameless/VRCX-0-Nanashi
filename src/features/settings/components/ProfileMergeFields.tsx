import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ProfileMergeSourceKind,
    type ProfileMergeSources
} from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';

import { Field } from './SettingsField';

const SOURCES: { kind: ProfileMergeSourceKind; appName: string }[] = [
    { kind: 'vrcx', appName: 'VRCX' },
    { kind: 'vrcx0', appName: 'VRCX-0' }
];

// Fork: non-destructive "merge data from VRCX / VRCX-0" buttons.
export function ProfileMergeFields() {
    const { t } = useTranslation();
    const [sources, setSources] = useState<ProfileMergeSources | null>(null);
    const [running, setRunning] = useState<{
        kind: ProfileMergeSourceKind | 'file';
        action: 'merge' | 'settings';
    } | null>(null);

    useEffect(() => {
        let active = true;
        commands
            .appProfileMergeSources()
            .then((result) => {
                if (active) setSources(result);
            })
            .catch(() => {
                if (active) setSources({ vrcx: null, vrcx0: null });
            });
        return () => {
            active = false;
        };
    }, []);

    async function merge(kind: ProfileMergeSourceKind, appName: string) {
        const confirmed = await useModalStore.getState().confirm({
            title: t('view.settings.profile_merge.confirm_title', {
                app: appName
            }),
            description: t('view.settings.profile_merge.confirm_description', {
                app: appName
            }),
            confirmText: t('view.settings.profile_merge.confirm'),
            cancelText: t('view.settings.profile_merge.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setRunning({ kind, action: 'merge' });
        try {
            const report = await commands.appProfileMergeRun(kind);
            toast.add({
                type: 'success',
                title: t('view.settings.profile_merge.done', {
                    app: appName,
                    rows: report.rowsAdded,
                    tables: report.tablesMerged,
                    settings: report.settingsFileKeysAdded
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setRunning(null);
        }
    }

    async function importSettings(
        kind: ProfileMergeSourceKind,
        appName: string
    ) {
        const confirmed = await useModalStore.getState().confirm({
            title: t('view.settings.profile_merge.settings_confirm_title', {
                app: appName
            }),
            description: t(
                'view.settings.profile_merge.settings_confirm_description',
                { app: appName }
            ),
            confirmText: t('view.settings.profile_merge.settings_button'),
            cancelText: t('view.settings.profile_merge.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setRunning({ kind, action: 'settings' });
        try {
            const report = await commands.appProfileSettingsImport(kind);
            toast.add({
                type: 'success',
                title: t('view.settings.profile_merge.settings_done', {
                    app: appName,
                    count:
                        report.configsImported + report.settingsFileKeysImported
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setRunning(null);
        }
    }

    // Fork (VRCX's DB Merger): any VRCX, VRCX-0 or VRCX-0-Nanashi database
    // file, such as an old backup, with the same non-destructive merge.
    async function mergeFile() {
        const path = await commands.appOpenFileSelectorDialog(
            null,
            null,
            'Database|*.sqlite3;*.sqlite;*.db'
        );
        if (typeof path !== 'string' || !path.trim()) {
            return;
        }
        const confirmed = await useModalStore.getState().confirm({
            title: t('view.settings.profile_merge.file_confirm_title'),
            description: t(
                'view.settings.profile_merge.file_confirm_description',
                { path }
            ),
            confirmText: t('view.settings.profile_merge.confirm'),
            cancelText: t('view.settings.profile_merge.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setRunning({ kind: 'file', action: 'merge' });
        try {
            const report = await commands.appProfileMergeRunFile(path);
            toast.add({
                type: 'success',
                title: t('view.settings.profile_merge.file_done', {
                    rows: report.rowsAdded,
                    tables: report.tablesMerged
                })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setRunning(null);
        }
    }

    return (
        <>
            {SOURCES.map(({ kind, appName }) => {
                const path = sources?.[kind] ?? null;
                return (
                    <Field
                        key={kind}
                        label={t('view.settings.profile_merge.label', {
                            app: appName
                        })}
                        description={
                            path
                                ? t('view.settings.profile_merge.description', {
                                      path
                                  })
                                : t('view.settings.profile_merge.not_found', {
                                      app: appName
                                  })
                        }
                    >
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!path || running !== null}
                                onClick={() =>
                                    void importSettings(kind, appName)
                                }
                            >
                                {running?.kind === kind &&
                                running.action === 'settings'
                                    ? t('view.settings.profile_merge.running')
                                    : t(
                                          'view.settings.profile_merge.settings_button'
                                      )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!path || running !== null}
                                onClick={() => void merge(kind, appName)}
                            >
                                {running?.kind === kind &&
                                running.action === 'merge'
                                    ? t('view.settings.profile_merge.running')
                                    : t('view.settings.profile_merge.button')}
                            </Button>
                        </div>
                    </Field>
                );
            })}
            <Field
                label={t('view.settings.profile_merge.file_label')}
                description={t('view.settings.profile_merge.file_description')}
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => void mergeFile()}
                >
                    {running?.kind === 'file'
                        ? t('view.settings.profile_merge.running')
                        : t('view.settings.profile_merge.file_button')}
                </Button>
            </Field>
        </>
    );
}
