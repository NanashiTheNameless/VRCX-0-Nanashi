import { AwardIcon, PlusIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomBadgeChip } from '@/components/UserBadges';
import {
    CUSTOM_BADGE_LIMIT,
    isUserListedOnBadge,
    setUserListedOnBadge,
    type CustomBadge
} from '@/domain/badges/customBadges';
import { toast } from '@/services/toastService';
import {
    ensureCustomBadgesLoaded,
    useCustomBadgeStore
} from '@/state/customBadgeStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger
} from '@/ui/shadcn/dropdown-menu';

import { BadgeEditor, newBadge } from './BadgeEditor';

function useSaveBadges() {
    const { t } = useTranslation();
    const update = useCustomBadgeStore((state) => state.update);
    return (change: (current: CustomBadge[]) => CustomBadge[]) =>
        update(change).catch((error: unknown) => {
            toast.add({
                type: 'error',
                title: t('view.settings.appearance.user_badges.save_failed'),
                description: error instanceof Error ? error.message : ''
            });
        });
}

export function UserBadgeActionSub({
    userId,
    onCreateBadge
}: {
    userId: string;
    onCreateBadge: () => void;
}) {
    const { t } = useTranslation();
    const badges = useCustomBadgeStore((state) => state.badges);
    const saveBadges = useSaveBadges();

    useEffect(() => {
        ensureCustomBadgesLoaded();
    }, []);

    if (!userId) {
        return null;
    }

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <AwardIcon />
                <span className="min-w-0 flex-1">
                    {t('dialog.user.actions.badges')}
                </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
                {badges.map((badge) => (
                    <DropdownMenuCheckboxItem
                        key={badge.id}
                        checked={isUserListedOnBadge(badge, userId)}
                        onClick={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                            void saveBadges((current) =>
                                current.map((entry) =>
                                    entry.id === badge.id
                                        ? setUserListedOnBadge(
                                              entry,
                                              userId,
                                              checked === true
                                          )
                                        : entry
                                )
                            )
                        }
                    >
                        <CustomBadgeChip badge={badge} size="full" />
                        {!badge.enabled ? (
                            <span className="text-muted-foreground ml-auto text-xs">
                                {t('dialog.user.actions.badge_off')}
                            </span>
                        ) : null}
                    </DropdownMenuCheckboxItem>
                ))}
                {badges.length ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                    disabled={badges.length >= CUSTOM_BADGE_LIMIT}
                    onClick={onCreateBadge}
                >
                    <PlusIcon />
                    {t('dialog.user.actions.badge_new')}
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

export function UserBadgeCreateDialog({
    userId,
    open,
    onOpenChange
}: {
    userId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation();
    const saveBadges = useSaveBadges();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.user.actions.badge_new_title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('dialog.user.actions.badge_new_description')}
                    </DialogDescription>
                </DialogHeader>
                {open ? (
                    <BadgeEditor
                        initial={{
                            ...newBadge(),
                            rules: [{ kind: 'users', userIds: [userId] }]
                        }}
                        onCancel={() => onOpenChange(false)}
                        onSave={(badge) => {
                            void saveBadges((current) => [...current, badge]);
                            onOpenChange(false);
                        }}
                    />
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
