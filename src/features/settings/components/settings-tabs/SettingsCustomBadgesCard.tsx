import {
    ArrowDownIcon,
    ArrowUpIcon,
    DownloadIcon,
    PencilIcon,
    PlusIcon,
    Trash2Icon,
    UploadIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    BadgeEditor,
    newBadge,
    useFriendGroupLabels
} from '@/components/badges/BadgeEditor';
import { describeCustomBadge } from '@/components/badges/badgeRuleText';
import {
    CustomBadgeExportDialog,
    CustomBadgeImportDialog
} from '@/components/badges/CustomBadgeTransferDialogs';
import { CustomBadgeChip } from '@/components/UserBadges';
import {
    CUSTOM_BADGE_WARN_COUNT,
    type CustomBadge,
    isReservedBadgeIcon
} from '@/domain/badges/customBadges';
import { mergeImportedBadges } from '@/domain/badges/customBadgeTransfer';
import { toast } from '@/services/toastService';
import {
    ensureCustomBadgesLoaded,
    useCustomBadgeStore
} from '@/state/customBadgeStore';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const T = 'view.settings.appearance.user_badges';

export function SettingsCustomBadgesCard() {
    const { t } = useTranslation();
    const badges = useCustomBadgeStore((state) => state.badges);
    const update = useCustomBadgeStore((state) => state.update);
    const [editing, setEditing] = useState<CustomBadge | null>(null);
    const [exporting, setExporting] = useState<CustomBadge[] | null>(null);
    const [importing, setImporting] = useState(false);
    const friendGroupLabel = useFriendGroupLabels();

    useEffect(() => {
        ensureCustomBadgesLoaded();
    }, []);

    function persist(change: (current: CustomBadge[]) => CustomBadge[]) {
        update(change).catch((error: unknown) => {
            toast.add({
                type: 'error',
                title: t(`${T}.save_failed`),
                description: error instanceof Error ? error.message : ''
            });
        });
    }

    function move(badgeId: string, offset: number) {
        persist((current) => {
            const index = current.findIndex((entry) => entry.id === badgeId);
            const target = index + offset;
            if (index < 0 || target < 0 || target >= current.length) {
                return current;
            }
            const next = [...current];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    }

    function importBadges(imported: CustomBadge[], replaceSameId: boolean) {
        let merged: ReturnType<typeof mergeImportedBadges> | null = null;
        update((current) => {
            merged = mergeImportedBadges(current, imported, replaceSameId);
            return merged.badges;
        })
            .then(() => {
                if (merged) {
                    toast.add({
                        type: 'success',
                        title: t(`${T}.transfer.imported`, {
                            added: merged.added,
                            replaced: merged.replaced
                        })
                    });
                }
            })
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title: t(`${T}.save_failed`),
                    description: error instanceof Error ? error.message : ''
                });
            });
    }

    return (
        <SettingsCard cardId="social.user-badges" title={t(`${T}.header`)}>
            <Field
                settingId="social.user-badges.list"
                label={t(`${T}.list`)}
                description={t(`${T}.list_description`)}
            >
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(editing)}
                        onClick={() => setImporting(true)}
                    >
                        <DownloadIcon />
                        {t(`${T}.transfer.import`)}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!badges.length}
                        onClick={() => setExporting([...badges])}
                    >
                        <UploadIcon />
                        {t(`${T}.transfer.export_all`)}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(editing)}
                        onClick={() => setEditing(newBadge())}
                    >
                        <PlusIcon />
                        {t(`${T}.add`)}
                    </Button>
                </div>
                {badges.length > CUSTOM_BADGE_WARN_COUNT ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t(`${T}.many_badges`, {
                            count: badges.length,
                            limit: CUSTOM_BADGE_WARN_COUNT
                        })}
                    </p>
                ) : null}
            </Field>
            <CustomBadgeExportDialog
                badges={exporting}
                onClose={() => setExporting(null)}
            />
            <CustomBadgeImportDialog
                open={importing}
                onClose={() => setImporting(false)}
                onImport={importBadges}
            />
            <div className="flex flex-col gap-2 px-4 pb-4">
                {editing && !badges.some((badge) => badge.id === editing.id) ? (
                    <BadgeEditor
                        initial={editing}
                        onCancel={() => setEditing(null)}
                        onSave={(badge) => {
                            persist((current) => [...current, badge]);
                            setEditing(null);
                        }}
                    />
                ) : null}
                {badges.map((badge, index) =>
                    editing?.id === badge.id ? (
                        <BadgeEditor
                            key={badge.id}
                            initial={editing}
                            onCancel={() => setEditing(null)}
                            onSave={(next) => {
                                persist((current) =>
                                    current.map((entry) =>
                                        entry.id === next.id ? next : entry
                                    )
                                );
                                setEditing(null);
                            }}
                        />
                    ) : (
                        <div
                            key={badge.id}
                            className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                        >
                            <CustomBadgeChip badge={badge} size="full" />
                            {isReservedBadgeIcon(badge.icon) ? (
                                <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                                    {t(`${T}.icon_now_reserved`)}
                                </span>
                            ) : null}
                            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                                {describeCustomBadge(badge, t, {
                                    friendGroupLabel
                                })}
                            </span>
                            <Switch
                                checked={badge.enabled}
                                aria-label={t(`${T}.enabled`)}
                                onCheckedChange={(enabled) =>
                                    persist((current) =>
                                        current.map((entry) =>
                                            entry.id === badge.id
                                                ? { ...entry, enabled }
                                                : entry
                                        )
                                    )
                                }
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(`${T}.move_up`)}
                                disabled={index === 0}
                                onClick={() => move(badge.id, -1)}
                            >
                                <ArrowUpIcon />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(`${T}.move_down`)}
                                disabled={index === badges.length - 1}
                                onClick={() => move(badge.id, 1)}
                            >
                                <ArrowDownIcon />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(`${T}.transfer.export`)}
                                onClick={() => setExporting([badge])}
                            >
                                <UploadIcon />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(`${T}.edit`)}
                                disabled={Boolean(editing)}
                                onClick={() => setEditing(badge)}
                            >
                                <PencilIcon />
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t(`${T}.delete`)}
                                onClick={() =>
                                    persist((current) =>
                                        current.filter(
                                            (entry) => entry.id !== badge.id
                                        )
                                    )
                                }
                            >
                                <Trash2Icon />
                            </Button>
                        </div>
                    )
                )}
            </div>
        </SettingsCard>
    );
}
