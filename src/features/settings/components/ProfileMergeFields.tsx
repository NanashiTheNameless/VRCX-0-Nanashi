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
        kind: ProfileMergeSourceKind;
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
        </>
    );
}
