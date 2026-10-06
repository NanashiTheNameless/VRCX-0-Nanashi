import {
    ClockIcon,
    CloudIcon,
    ImageIcon,
    LockIcon,
    MapPinIcon,
    StickyNoteIcon,
    UserIcon,
    UsersIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FriendInstanceTimer } from '@/components/friends/FriendInstanceTimer';
import { Location } from '@/components/Location';
import { FadeInImage } from '@/components/media/FadeInImage';
import {
    ProfileAvatarFrame,
    ProfileEffect,
    ProfileNameplate
} from '@/components/ProfileDecorations';
import { UserStatusDot } from '@/components/UserStatusDot';
import { timeToText } from '@/lib/dateTime';
import { openUserDialog, openWorldDialog } from '@/services/dialogService';
import { TRUST_COLOR_ENTRIES } from '@/shared/constants/trustColors';
import { getTrustColor } from '@/shared/utils/trustColors';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { UserHoverCardMutuals } from './UserHoverCardMutuals';
import { useUserHoverCardData } from './useUserHoverCardData';

type UserHoverCardContentProps = {
    userId: string;
    seed?: Parameters<typeof useUserHoverCardData>[0]['seed'];
};

function NoteLine({
    icon,
    label,
    text
}: {
    icon: ReactNode;
    label: ReactNode;
    text: ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-start gap-1.5">
            <span className="text-muted-foreground/70 flex shrink-0 items-center gap-1 pt-px text-[11px]">
                {icon}
                {label}
            </span>
            <span className="text-foreground/80 min-w-0 flex-1 break-words">
                {text}
            </span>
        </div>
    );
}

export function UserHoverCardContent({
    userId,
    seed = null
}: UserHoverCardContentProps) {
    const { t } = useTranslation();
    const {
        model,
        worldThumb,
        population,
        populationLoading,
        memo,
        trustColor,
        instanceEpoch
    } = useUserHoverCardData({ userId, seed });
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const showAvatarFrame = usePreferencesStore(
        (state) => state.showHoverCardAvatarFrame
    );
    const showProfileEffect = usePreferencesStore(
        (state) => state.showHoverCardProfileEffect
    );
    const showNameplate = usePreferencesStore(
        (state) => state.showHoverCardNameplate
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const isFriend = useFriendRosterStore((state) =>
        Boolean(state.friendsById[userId])
    );
    const showMutuals =
        !isFriend && Boolean(userId) && userId !== currentUserId;
    const worldDialogTarget = model.location.tag || model.location.worldId;

    const trustEntry = TRUST_COLOR_ENTRIES.find(
        (entry) => entry.key === model.trustKey
    );
    const trustLabel = trustEntry ? t(trustEntry.labelKey) : '';
    const displayName = String(model.displayName || '');
    const nameColour = String(
        model.userColour || getTrustColor(model.trustSource, trustColor)
    );
    const statusText = model.statusKey ? t(model.statusKey) : '';
    const statusDotClassName = model.statusDotClassName || '';
    const hasStatusDescription = Boolean(model.statusDescription);
    const isOffline = model.variant === 'offline';
    const showInlineStatus = Boolean(statusText) && !hasStatusDescription;
    const showThumbnailBanner = model.variant === 'in-instance';
    const iconFrameId = showAvatarFrame ? model.decorations.iconFrame : '';
    const profileEffectId = showProfileEffect
        ? model.decorations.profileEffect
        : '';
    const nameplateId = showNameplate ? model.decorations.nameplateEffect : '';
    const onlineForText =
        model.onlineForMs > 0 ? timeToText(model.onlineForMs) : '';

    return (
        <div className="relative isolate w-full">
            {profileEffectId ? (
                <ProfileEffect templateId={profileEffectId} active />
            ) : null}
            {showThumbnailBanner ? (
                <button
                    type="button"
                    className="bg-muted flex h-28 w-full items-center justify-center overflow-hidden enabled:cursor-pointer"
                    disabled={!worldDialogTarget}
                    onClick={() =>
                        worldDialogTarget &&
                        openWorldDialog({ worldId: worldDialogTarget })
                    }
                >
                    {worldThumb ? (
                        <FadeInImage
                            src={worldThumb}
                            alt=""
                            className="size-full object-cover"
                            fallback={
                                <ImageIcon className="text-muted-foreground size-7 opacity-50" />
                            }
                        />
                    ) : (
                        <ImageIcon className="text-muted-foreground size-7 opacity-50" />
                    )}
                </button>
            ) : null}

            <div className="space-y-2.5 p-3">
                <div className="relative isolate -mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5">
                    {nameplateId ? (
                        <ProfileNameplate templateId={nameplateId} active />
                    ) : null}
                    <button
                        type="button"
                        className="relative flex size-10 shrink-0 rounded-full enabled:cursor-pointer"
                        disabled={!model.avatarPreviewUrl}
                        onClick={() =>
                            model.avatarPreviewUrl &&
                            openImagePreview({
                                url: model.avatarPreviewUrl,
                                title: displayName
                            })
                        }
                    >
                        <span className="bg-muted flex size-full items-center justify-center overflow-hidden rounded-full border">
                            {model.avatarUrl ? (
                                <FadeInImage
                                    src={model.avatarUrl}
                                    alt=""
                                    className="size-full object-cover"
                                    fallback={
                                        <UserIcon className="text-muted-foreground size-5" />
                                    }
                                />
                            ) : (
                                <UserIcon className="text-muted-foreground size-5" />
                            )}
                        </span>
                        {iconFrameId ? (
                            <ProfileAvatarFrame
                                templateId={iconFrameId}
                                active
                            />
                        ) : null}
                        <UserStatusDot
                            statusDotClassName={statusDotClassName}
                            className="absolute -right-0.5 -bottom-0.5 z-10 size-3.75"
                        />
                    </button>
                    <span className="min-w-0 flex-1">
                        <button
                            type="button"
                            className="block w-full cursor-pointer truncate text-left text-sm font-medium"
                            style={{ color: nameColour }}
                            onClick={() => openUserDialog({ userId })}
                        >
                            {displayName}
                        </button>
                        {trustLabel ? (
                            <span className="text-muted-foreground block truncate text-xs">
                                {trustLabel}
                            </span>
                        ) : null}
                    </span>
                    {onlineForText ? (
                        <span
                            className="text-muted-foreground/80 flex shrink-0 items-center gap-1 text-[11px]"
                            title={t('dialog.user.info.estimated_online_for', {
                                duration: onlineForText
                            })}
                        >
                            <ClockIcon className="text-muted-foreground size-3 opacity-56" />
                            {onlineForText}
                        </span>
                    ) : null}
                </div>

                {showInlineStatus || hasStatusDescription ? (
                    <div className="flex min-w-0 items-center gap-1.5 text-xs">
                        {showInlineStatus ? (
                            <UserStatusDot
                                statusDotClassName={statusDotClassName}
                                className="size-2 shrink-0"
                                variant="inline"
                            />
                        ) : null}
                        {showInlineStatus ? (
                            <span className="text-foreground/90 shrink-0">
                                {statusText}
                            </span>
                        ) : null}
                        {hasStatusDescription ? (
                            <span className="text-muted-foreground min-w-0 truncate">
                                {model.statusDescription}
                            </span>
                        ) : null}
                    </div>
                ) : null}

                {model.variant === 'in-instance' ? (
                    <div className="space-y-1.5">
                        <Location
                            location={model.location.effectiveLocation}
                            disableTooltip
                            className="text-muted-foreground text-xs"
                            worldNameClassName="text-foreground font-medium"
                        />
                        <div className="flex items-center gap-3.5 text-xs">
                            {population ? (
                                <span className="text-foreground/90 inline-flex items-center gap-1.5">
                                    <UsersIcon className="text-muted-foreground size-3.5" />
                                    <span>
                                        {population.capacity
                                            ? `${population.nUsers}/${population.capacity}`
                                            : population.nUsers}
                                    </span>
                                </span>
                            ) : populationLoading ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <UsersIcon className="text-muted-foreground size-3.5" />
                                    <Skeleton className="h-3 w-9" />
                                </span>
                            ) : null}
                            {instanceEpoch ? (
                                <span className="text-foreground/90 inline-flex items-center gap-1.5">
                                    <ClockIcon className="text-muted-foreground size-3.5" />
                                    <FriendInstanceTimer
                                        epoch={instanceEpoch}
                                        traveling={model.location.isTraveling}
                                    />
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {model.variant === 'private' ? (
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <LockIcon className="size-3.5" />
                        <span>{t('user_hover_card.in_private_world')}</span>
                    </div>
                ) : null}

                {isOffline && model.lastOnlineAgoMs ? (
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <MapPinIcon className="size-3.5" />
                        <span className="min-w-0 truncate">
                            {t('user_hover_card.last_online', {
                                duration: timeToText(model.lastOnlineAgoMs)
                            })}
                        </span>
                    </div>
                ) : null}

                {showMutuals ? <UserHoverCardMutuals userId={userId} /> : null}

                {memo || model.note ? (
                    <div className="space-y-1.5 border-t pt-2.5 text-xs">
                        {memo ? (
                            <NoteLine
                                icon={
                                    <StickyNoteIcon className="text-muted-foreground size-3.5 opacity-70" />
                                }
                                label={t('user_hover_card.note_local')}
                                text={memo}
                            />
                        ) : null}
                        {model.note ? (
                            <NoteLine
                                icon={
                                    <CloudIcon className="text-muted-foreground size-3.5 opacity-70" />
                                }
                                label={t('user_hover_card.note_synced')}
                                text={model.note}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
