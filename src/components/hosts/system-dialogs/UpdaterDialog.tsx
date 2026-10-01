import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/entityMediaService';
import { setStringConfigPreference } from '@/services/preferencesService';
import { restartApplication } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import {
    confirmInstall,
    formatReleaseDisplayVersion,
    getPreviewStableReleaseUpdateMode,
    toNormalizedReleaseFromSnapshot,
    type NormalizedRelease
} from '@/services/updateService';
import {
    getBuildTimeMs,
    isUpdateCheckDisabledBuild
} from '@/shared/buildLabel';
import { links } from '@/shared/constants/link';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/ui/shadcn/alert-dialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { FieldGroup } from '@/ui/shadcn/field';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    buildVersionList,
    installKindFor,
    type VersionListEntry
} from './updaterVersionList';

type UpdaterDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function UpdaterDialog({ open, onOpenChange }: UpdaterDialogProps) {
    const { t } = useTranslation();
    const isPreviewUpdateCheck = getPreviewStableReleaseUpdateMode().enabled;
    const updateCheckDisabled = isUpdateCheckDisabledBuild();
    const [latestRelease, setLatestRelease] =
        useState<NormalizedRelease | null>(null);
    const [hasNewerRelease, setHasNewerRelease] = useState(false);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [detail, setDetail] = useState('');
    // Fork: every installable release of this channel, newest first, for
    // reinstalling (repair) or downgrading.
    const [versions, setVersions] = useState<NormalizedRelease[]>([]);
    const [selectedVersion, setSelectedVersion] = useState('');
    // A downgrade waits here until the user confirms it; cancel clears it.
    const [pendingDowngrade, setPendingDowngrade] =
        useState<NormalizedRelease | null>(null);
    const autoUpdateMode = usePreferencesStore((state) => state.autoUpdateVRCX);
    const autoUpdateWillUndoDowngrade =
        autoUpdateMode === 'Auto Download' || autoUpdateMode === 'Auto Install';
    const [savingUpdateMode, setSavingUpdateMode] = useState(false);

    // Fork: switch Updates to Notify only from the downgrade warning.
    async function setUpdatesToNotifyOnly() {
        setSavingUpdateMode(true);
        try {
            await setStringConfigPreference('autoUpdateVRCX', 'Notify');
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(
                        'dialog.vrcx_updater.downgrade_confirm.set_notify_only_failed'
                    )
                )
            });
        } finally {
            setSavingUpdateMode(false);
        }
    }
    const canInstallUpdate = latestRelease?.updaterType === 'tauri';
    const autoDownloadState = useRuntimeStore(
        (state) => state.updateLoop.autoDownloadState
    );
    const downloadedVersion = useRuntimeStore(
        (state) => state.updateLoop.downloadedVersion
    );
    const downloadProgress = useRuntimeStore(
        (state) => state.updateLoop.downloadProgress
    );
    const hasMatchingDownload =
        latestRelease?.canonicalVersion === downloadedVersion;
    const progress = hasMatchingDownload ? downloadProgress : 0;
    const showDownloadProgress =
        canInstallUpdate &&
        (downloading ||
            (autoDownloadState === 'downloading' && hasMatchingDownload));
    const currentVersionText =
        formatReleaseDisplayVersion(VERSION || '') || '-';
    const latestVersionText =
        latestRelease?.displayVersion ||
        (latestRelease?.canonicalVersion
            ? formatReleaseDisplayVersion(latestRelease.canonicalVersion)
            : '') ||
        '-';
    const isUpToDate = Boolean(latestRelease && !hasNewerRelease);
    const currentVersion = VERSION || '';
    const versionList = buildVersionList(
        versions,
        currentVersion,
        getBuildTimeMs()
    );
    const selectedIndex = versionList.findIndex(
        (entry) => entry.release.canonicalVersion === selectedVersion
    );
    const selectedEntry =
        selectedIndex >= 0 ? versionList[selectedIndex] : null;
    const selectedRelease = selectedEntry?.release ?? null;
    // Without the installed version in the list, anything but the newest may
    // be older.
    const isDowngradeSelected = selectedEntry
        ? selectedEntry.offset === null
            ? selectedIndex > 0
            : selectedEntry.offset < 0
        : false;
    const selectedInstallKind = selectedEntry
        ? installKindFor(selectedEntry, selectedIndex)
        : 'unknown';

    // "-1 · 3.0.0-Nightly-abc1234": the number is the position relative to the
    // installed version (0), newer releases counting up.
    function releaseLabel({ release, offset }: VersionListEntry) {
        const text =
            release.displayVersion ||
            formatReleaseDisplayVersion(release.canonicalVersion) ||
            release.canonicalVersion;
        const label =
            release.canonicalVersion === currentVersion
                ? t('dialog.vrcx_updater.installed_version', { value: text })
                : text;
        return offset === null ? label : `${offset} · ${label}`;
    }

    useEffect(() => {
        if (!open || updateCheckDisabled) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setLatestRelease(null);
        setHasNewerRelease(false);
        setVersions([]);
        setSelectedVersion('');
        setDetail(t('message.vrcx_updater.checking_update_state'));

        commands
            .appAppUpdateReleasesList()
            .then((releases) => {
                if (active) {
                    setVersions(
                        releases
                            .map((release) =>
                                toNormalizedReleaseFromSnapshot(release)
                            )
                            .filter(
                                (release): release is NormalizedRelease =>
                                    release !== null
                            )
                    );
                }
            })
            .catch((error: unknown) => {
                console.warn('Failed to list installable releases:', error);
            });

        commands
            .appAppUpdateCheckRun()
            .then((snapshot) => {
                if (!active) {
                    return;
                }

                if (snapshot.error) {
                    setDetail(
                        userFacingErrorMessage(
                            snapshot.error,
                            t(
                                'message.vrcx_updater.failed_to_load_update_releases'
                            )
                        )
                    );
                    return;
                }

                const nextRelease = toNormalizedReleaseFromSnapshot(
                    snapshot.release
                );
                setLatestRelease(nextRelease);
                setHasNewerRelease(snapshot.hasAvailableUpdate);
                setDetail(
                    nextRelease
                        ? ''
                        : !isPreviewUpdateCheck
                          ? t(
                                'message.vrcx_updater.no_downloadable_releases_found'
                            )
                          : t('message.vrcx_updater.no_releases_found')
                );
            })
            .catch((error: unknown) => {
                if (active) {
                    setDetail(
                        userFacingErrorMessage(
                            error,
                            t(
                                'message.vrcx_updater.failed_to_load_update_releases'
                            )
                        )
                    );
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [isPreviewUpdateCheck, open, t, updateCheckDisabled]);

    // Installs `release`: an update, a reinstall of the running version
    // (repair), or a downgrade.
    async function handleInstall(release: NormalizedRelease | null) {
        if (!release || loading || showDownloadProgress || downloading) {
            return;
        }

        setDownloading(true);
        setDetail(
            t('host.system_dialogs.dynamic.downloading_value', {
                value:
                    release.displayVersion ||
                    formatReleaseDisplayVersion(release.canonicalVersion) ||
                    release.canonicalVersion
            })
        );
        try {
            await confirmInstall(release.canonicalVersion);
            await restartApplication();
        } catch (error) {
            const details = error instanceof Error ? error.message : error;
            const message = userFacingErrorMessage(
                typeof details === 'string'
                    ? details.replace(
                          /^Tauri command failed: [a-zA-Z0-9_]+:\s*/,
                          ''
                      )
                    : details,
                t('message.vrcx_updater.failed_install')
            );
            setDetail(message);
            toast.add({ type: 'error', description: message });
        } finally {
            setDownloading(false);
        }
    }

    async function handleOpenReleasePage() {
        await openExternalLink(latestRelease?.htmlUrl || links.releases);
    }

    if (updateCheckDisabled) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t('dialog.system.label.vrcx_0_update')}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.general.application.update_check_disabled_build_description'
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                        <div className="border-input bg-background flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                            <span className="text-foreground font-medium">
                                {t(
                                    'view.settings.general.application.check_for_updates_and_update'
                                )}
                            </span>
                            <Badge variant="secondary">
                                {t(
                                    'view.settings.general.application.update_check_disabled'
                                )}
                            </Badge>
                        </div>
                    </FieldGroup>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.system.label.vrcx_0_update')}
                    </DialogTitle>
                    <DialogDescription>
                        {isUpToDate
                            ? t('dialog.vrcx_updater.latest_version')
                            : t('dialog.system.dynamic.version_summary', {
                                  current: currentVersionText,
                                  latest: latestVersionText
                              })}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <div className="border-input bg-background flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                        <div className="text-muted-foreground text-xs">
                            {isUpToDate
                                ? t('message.vrcx_updater.current_version')
                                : t('dialog.system.action.update_path')}
                        </div>
                        <div className="text-foreground truncate font-medium tabular-nums">
                            {isUpToDate
                                ? currentVersionText
                                : `${currentVersionText} -> ${latestVersionText}`}
                        </div>
                    </div>
                    {showDownloadProgress ? (
                        <div className="flex flex-col gap-2">
                            <div className="bg-muted h-2 overflow-hidden rounded-full">
                                <div
                                    className="bg-primary h-full transition-[width]"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <div className="text-muted-foreground text-xs">
                                {autoDownloadState === 'downloaded' ||
                                autoDownloadState === 'installing'
                                    ? t(
                                          'message.vrcx_updater.installing_update'
                                      )
                                    : `${progress}%`}
                            </div>
                        </div>
                    ) : null}
                    {canInstallUpdate &&
                    !isPreviewUpdateCheck &&
                    versionList.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-muted-foreground text-xs">
                                {t('dialog.vrcx_updater.other_versions')}
                            </div>
                            <div className="flex gap-2">
                                <Select
                                    value={selectedVersion}
                                    onValueChange={(value) =>
                                        setSelectedVersion(value ?? '')
                                    }
                                >
                                    <SelectTrigger
                                        className="min-w-0 flex-1"
                                        aria-label={t(
                                            'dialog.vrcx_updater.other_versions'
                                        )}
                                    >
                                        <SelectValue
                                            placeholder={t(
                                                'dialog.vrcx_updater.choose_version'
                                            )}
                                        >
                                            {selectedEntry
                                                ? releaseLabel(selectedEntry)
                                                : null}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {versionList.map((entry) => (
                                                <SelectItem
                                                    key={
                                                        entry.release
                                                            .canonicalVersion
                                                    }
                                                    value={
                                                        entry.release
                                                            .canonicalVersion
                                                    }
                                                >
                                                    {releaseLabel(entry)}
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        !selectedRelease ||
                                        loading ||
                                        downloading ||
                                        showDownloadProgress
                                    }
                                    onClick={() => {
                                        if (isDowngradeSelected) {
                                            setPendingDowngrade(
                                                selectedRelease
                                            );
                                            return;
                                        }
                                        void handleInstall(selectedRelease);
                                    }}
                                >
                                    {t(
                                        `dialog.vrcx_updater.install_action.${selectedInstallKind}`
                                    )}
                                </Button>
                            </div>
                            {isDowngradeSelected ? (
                                <div className="text-sm text-amber-700 dark:text-amber-400">
                                    {t('dialog.vrcx_updater.downgrade_warning')}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {detail ? (
                        <div className="text-muted-foreground text-sm">
                            {userFacingErrorMessage(
                                detail,
                                t('message.vrcx_updater.failed_install')
                            )}
                        </div>
                    ) : null}
                </FieldGroup>
                <DialogFooter>
                    {canInstallUpdate && !isPreviewUpdateCheck ? (
                        <Button
                            type="button"
                            disabled={
                                !latestRelease ||
                                loading ||
                                downloading ||
                                showDownloadProgress
                            }
                            onClick={() => {
                                void handleInstall(latestRelease);
                            }}
                        >
                            {isUpToDate
                                ? t('dialog.vrcx_updater.reinstall')
                                : t('dialog.system.action.install_and_restart')}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            disabled={loading || !latestRelease}
                            onClick={() => {
                                handleOpenReleasePage();
                            }}
                        >
                            {t('nav_menu.update')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
            <AlertDialog
                open={pendingDowngrade !== null}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setPendingDowngrade(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('dialog.vrcx_updater.downgrade_confirm.title', {
                                value: pendingDowngrade
                                    ? pendingDowngrade.displayVersion ||
                                      formatReleaseDisplayVersion(
                                          pendingDowngrade.canonicalVersion
                                      ) ||
                                      pendingDowngrade.canonicalVersion
                                    : ''
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('dialog.vrcx_updater.downgrade_warning')}
                        </AlertDialogDescription>
                        {autoUpdateWillUndoDowngrade ? (
                            <>
                                <AlertDialogDescription>
                                    {t(
                                        'dialog.vrcx_updater.downgrade_confirm.auto_update_note'
                                    )}
                                </AlertDialogDescription>
                                <div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={savingUpdateMode}
                                        onClick={() =>
                                            void setUpdatesToNotifyOnly()
                                        }
                                    >
                                        {t(
                                            'dialog.vrcx_updater.downgrade_confirm.set_notify_only'
                                        )}
                                    </Button>
                                </div>
                            </>
                        ) : null}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>
                            {t('common.actions.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => {
                                const release = pendingDowngrade;
                                setPendingDowngrade(null);
                                void handleInstall(release);
                            }}
                        >
                            {t('dialog.vrcx_updater.install_action.downgrade')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}
