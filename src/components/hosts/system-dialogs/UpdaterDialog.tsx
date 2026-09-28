import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/entityMediaService';
import { restartApplication } from '@/services/shellIntegrationService';
import {
    confirmInstall,
    formatReleaseDisplayVersion,
    getPreviewStableReleaseUpdateMode,
    toNormalizedReleaseFromSnapshot,
    type NormalizedRelease
} from '@/services/updateService';
import { isUpdateCheckDisabledBuild } from '@/shared/buildLabel';
import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';
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

    useEffect(() => {
        if (!open || updateCheckDisabled) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setLatestRelease(null);
        setHasNewerRelease(false);
        setDetail(t('message.vrcx_updater.checking_update_state'));

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

    async function handleInstallUpdate() {
        if (
            !canInstallUpdate ||
            !latestRelease ||
            !hasNewerRelease ||
            loading ||
            showDownloadProgress
        ) {
            return;
        }

        setDownloading(true);
        setDetail(
            t('host.system_dialogs.dynamic.downloading_value', {
                value: latestVersionText
            })
        );
        try {
            await confirmInstall(latestRelease.canonicalVersion);
            await restartApplication();
        } catch (error) {
            setDetail(
                userFacingErrorMessage(
                    error,
                    t('message.vrcx_updater.failed_install')
                )
            );
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
                                !hasNewerRelease ||
                                loading ||
                                showDownloadProgress
                            }
                            onClick={() => {
                                handleInstallUpdate();
                            }}
                        >
                            {t('dialog.system.action.install_and_restart')}
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
        </Dialog>
    );
}
