import { ExternalLinkIcon, MoreHorizontalIcon, Share2Icon } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/entityMediaService';
import {
    vrchatAvatarUrl,
    vrchatUserUrl,
    vrchatWorldUrl
} from '@/shared/constants/vrchatWebUrls';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import type { FavoriteItem } from '../favoritesTypes';

export interface FavoriteCardActionMenuModel {
    item: FavoriteItem;
    removing: boolean;
    canRemoveLocal: boolean;
    canRemoveRemote: boolean;
    canSelectAvatar: boolean;
    canUseFriendLocation: boolean;
    canSendInvite: boolean;
    canBoop: boolean;
    canUseWorldActions: boolean;
    canCopyWorldId: boolean;
    isCurrentUser: boolean;
    worldFollowUpActionLabelKey: string;
}

export interface FavoriteCardActionMenuActions {
    openDetails: (() => void) | null;
    copyWorldId: () => void;
    removeLocal?: (item: FavoriteItem) => void;
    removeRemote?: (item: FavoriteItem) => void;
    friendLaunch?: (item: FavoriteItem) => void;
    friendSelfInvite?: (item: FavoriteItem) => void;
    friendInvite?: (item: FavoriteItem) => void;
    friendRequestInvite?: (item: FavoriteItem) => void;
    friendBoop?: (item: FavoriteItem) => void;
    worldNewInstance?: (item: FavoriteItem) => void;
    worldSelfInvite?: (item: FavoriteItem) => void;
    avatarSelect?: (item: FavoriteItem) => void;
    stopInteraction: (
        event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
    ) => void;
}

export function FavoriteCardActionMenu({
    model,
    actions
}: {
    model: FavoriteCardActionMenuModel;
    actions: FavoriteCardActionMenuActions;
}) {
    const { t } = useTranslation();
    const { item } = model;
    const userPageUrl = item.kind === 'friend' ? vrchatUserUrl(item.id) : '';
    const worldId = item.kind === 'world' ? item.id : '';
    const worldPageUrl = worldId ? vrchatWorldUrl(worldId) : '';
    const avatarId = item.kind === 'avatar' ? item.id : '';
    const avatarPageUrl = avatarId ? vrchatAvatarUrl(avatarId) : '';
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common.actions.configure')}
                        disabled={model.removing}
                        onClick={actions.stopInteraction}
                    >
                        {model.removing ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <MoreHorizontalIcon data-icon="inline-start" />
                        )}
                    </Button>
                }
            />
            <DropdownMenuContent
                align="end"
                onClick={actions.stopInteraction}
                onKeyDown={actions.stopInteraction}
                onPointerDown={actions.stopInteraction}
            >
                <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => actions.openDetails?.()}>
                        {t('common.actions.view_details')}
                    </DropdownMenuItem>
                    {item.kind === 'friend' ? (
                        <DropdownMenuItem
                            disabled={!userPageUrl}
                            onClick={() => {
                                void openExternalLink(userPageUrl);
                            }}
                        >
                            <ExternalLinkIcon data-icon="inline-start" />
                            {t('common.actions.view_on_website')}
                        </DropdownMenuItem>
                    ) : null}
                    {item.kind === 'world' ? (
                        <>
                            <DropdownMenuItem
                                disabled={!worldPageUrl}
                                onClick={() => {
                                    void openExternalLink(worldPageUrl);
                                }}
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                {t('common.actions.view_on_website')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={!worldPageUrl}
                                onClick={() => {
                                    void copyTextToClipboard(worldPageUrl, {
                                        successMessage: t(
                                            'dialog.world.dynamic.value_copied',
                                            {
                                                value: t(
                                                    'dialog.world.info.url'
                                                )
                                            }
                                        )
                                    });
                                }}
                            >
                                <Share2Icon data-icon="inline-start" />
                                {t('dialog.world.info.copy_url')}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                    {model.canCopyWorldId ? (
                        <DropdownMenuItem onClick={actions.copyWorldId}>
                            {t('dialog.world.info.copy_id')}
                        </DropdownMenuItem>
                    ) : null}
                    {item.kind === 'avatar' ? (
                        <>
                            <DropdownMenuItem
                                disabled={!avatarPageUrl}
                                onClick={() => {
                                    void openExternalLink(avatarPageUrl);
                                }}
                            >
                                <ExternalLinkIcon data-icon="inline-start" />
                                {t('common.actions.view_on_website')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={!avatarPageUrl}
                                onClick={() => {
                                    void copyTextToClipboard(avatarPageUrl, {
                                        successMessage: t(
                                            'dialog.avatar.dynamic.value_copied',
                                            {
                                                value: t(
                                                    'dialog.avatar.info.url'
                                                )
                                            }
                                        )
                                    });
                                }}
                            >
                                <Share2Icon data-icon="inline-start" />
                                {t('dialog.avatar.info.copy_url')}
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuGroup>
                {item.kind === 'avatar' ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={!model.canSelectAvatar}
                                onClick={() => actions.avatarSelect?.(item)}
                            >
                                {t('dialog.avatar.actions.select')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : null}
                {item.kind === 'friend' ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={
                                    model.isCurrentUser ||
                                    !actions.friendRequestInvite
                                }
                                onClick={() =>
                                    actions.friendRequestInvite?.(item)
                                }
                            >
                                {t('dialog.user.actions.request_invite')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={
                                    model.isCurrentUser ||
                                    !model.canSendInvite ||
                                    !actions.friendInvite
                                }
                                onClick={() => actions.friendInvite?.(item)}
                            >
                                {t('dialog.user.actions.invite')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={
                                    model.isCurrentUser ||
                                    !model.canBoop ||
                                    !actions.friendBoop
                                }
                                onClick={() => actions.friendBoop?.(item)}
                            >
                                {t('dialog.user.actions.send_boop')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={
                                    !model.canUseFriendLocation ||
                                    !actions.friendLaunch
                                }
                                onClick={() => actions.friendLaunch?.(item)}
                            >
                                {t('dialog.launch.open_ingame')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={
                                    !model.canUseFriendLocation ||
                                    !actions.friendSelfInvite
                                }
                                onClick={() => actions.friendSelfInvite?.(item)}
                            >
                                {t('dialog.launch.self_invite')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : null}
                {model.canUseWorldActions ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                disabled={!actions.worldNewInstance}
                                onClick={() => actions.worldNewInstance?.(item)}
                            >
                                {t('dialog.world.actions.new_instance')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                disabled={!actions.worldSelfInvite}
                                onClick={() => actions.worldSelfInvite?.(item)}
                            >
                                {t(model.worldFollowUpActionLabelKey)}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : null}
                {model.canRemoveLocal || model.canRemoveRemote ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                    if (model.canRemoveLocal) {
                                        actions.removeLocal?.(item);
                                        return;
                                    }
                                    actions.removeRemote?.(item);
                                }}
                            >
                                {model.canRemoveLocal
                                    ? t('common.actions.delete')
                                    : t('view.favorite.action.remove_favorite')}
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
