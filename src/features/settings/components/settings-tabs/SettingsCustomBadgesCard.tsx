import {
    ArrowDownIcon,
    ArrowUpIcon,
    PencilIcon,
    PlusIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BadgeEditor, newBadge } from '@/components/badges/BadgeEditor';
import { CustomBadgeChip } from '@/components/UserBadges';
import {
    CUSTOM_BADGE_LIMIT,
    type CustomBadge
} from '@/domain/badges/customBadges';
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

    return (
        <SettingsCard cardId="interface.user-badges" title={t(`${T}.header`)}>
            <Field
                settingId="interface.user-badges.list"
                label={t(`${T}.list`)}
                description={t(`${T}.list_description`)}
            >
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                        Boolean(editing) || badges.length >= CUSTOM_BADGE_LIMIT
                    }
                    onClick={() => setEditing(newBadge())}
                >
                    <PlusIcon />
                    {t(`${T}.add`)}
                </Button>
            </Field>
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
                            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                                {badge.rules.length
                                    ? badge.rules
                                          .map((rule) =>
                                              t(`${T}.rule.${rule.kind}`)
                                          )
                                          .join(', ')
                                    : t(`${T}.no_rules`)}
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
