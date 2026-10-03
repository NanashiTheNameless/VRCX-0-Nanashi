import { BellIcon, CheckCheckIcon, RefreshCcwIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InviteMessageDialog } from '@/components/dialogs/InviteMessageDialog';
import { BoopReplyDialog } from '@/features/notifications/components/NotificationViewParts';
import { NotificationDrawerList } from '@/features/notifications/drawer/NotificationDrawerList';
import type {
    NotificationDialogRequest,
    NotificationRow
} from '@/features/notifications/notificationPageTypes';
import { useNotificationActions } from '@/features/notifications/useNotificationActions';
import { useNotificationTypeLabel } from '@/features/notifications/useNotificationTypeLabel';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { preserveAppTitleBarOnOpenChange } from '@/lib/overlayTitlebar';
import { cn } from '@/lib/utils';
import { openWorldDialog } from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/ui/shadcn/sheet';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useNotificationRuntime } from './useNotificationRuntime';

type InviteResponseSlotPayload = {
    imageData: string;
    notification: NotificationRow;
    row: {
        slot: number;
    };
};

export function VrcNotificationCenterHost() {
    const { t } = useTranslation();
    const notificationTypeLabel = useNotificationTypeLabel();
    const {
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId,
        endpoint,
        isLocalUserVrcPlusSupporter
    } = useNotificationRuntime();
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const isCenterOpen = useVrcNotificationStore((state) => state.isCenterOpen);
    const categories = useVrcNotificationStore((state) => state.categories);
    const unseenCount = useVrcNotificationStore((state) => state.unseenCount);
    const loadStatus = useVrcNotificationStore((state) => state.loadStatus);
    const detail = useVrcNotificationStore((state) => state.detail);
    const setCenterOpen = useVrcNotificationStore(
        (state) => state.setCenterOpen
    );
    const refreshForCurrentUser = useVrcNotificationStore(
        (state) => state.refreshForCurrentUser
    );
    const [inviteResponseRequest, setInviteResponseRequest] =
        useState<NotificationDialogRequest>(null);
    const [boopReplyRequest, setBoopReplyRequest] =
        useState<NotificationRow | null>(null);
    const {
        acceptFriendRequest,
        acceptRequestInvite,
        deleteNotification,
        hideNotification,
        ignoreNotificationLocally,
        markAllSeen,
        markSeen,
        sendBoopReply,
        sendInviteResponseSlot,
        sendInviteResponseWithMessage,
        sendNotificationResponse
    } = useNotificationActions({
        canInviteFromCurrentLocation,
        currentInviteLocation,
        currentUserId: currentUserId ?? undefined,
        notificationTypeLabel,
        reload: refreshForCurrentUser,
        setBoopReplyRequest,
        setInviteResponseRequest
    });

    function markAllRead() {
        if (unseenCount <= 0) {
            return;
        }
        void markAllSeen();
    }

    function handleOpenChange(open: boolean) {
        if (!open) {
            setInviteResponseRequest(null);
            setBoopReplyRequest(null);
        }
        setCenterOpen(open);
    }

    function joinQueueReady(notification: NotificationRow) {
        const location = String(notification?.location || '').trim();
        if (!location) {
            return;
        }
        openWorldDialog({
            worldId: location,
            title:
                notification?.worldName ||
                notification?.details?.worldName ||
                ''
        });
    }

    function navigateToTable() {
        handleOpenChange(false);
        window.location.hash = '#/notification?fromCenter=1';
    }

    return (
        <>
            <Sheet
                open={isCenterOpen}
                modal="trap-focus"
                onOpenChange={(open, eventDetails) => {
                    if (preserveAppTitleBarOnOpenChange(open, eventDetails)) {
                        return;
                    }
                    handleOpenChange(open);
                }}
            >
                <SheetContent
                    side="right"
                    variant="inset"
                    showCloseButton={false}
                    className={cn(
                        'flex w-full! flex-col gap-0 p-0 sm:max-w-[40rem]!',
                        sidebarWindowMode &&
                            'm-4 w-[calc(100%-(--spacing(8)))]! rounded-2xl border'
                    )}
                >
                    <SheetHeader className="border-b px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <SheetTitle className="flex items-center gap-2 text-base">
                                <BellIcon className="text-muted-foreground size-4" />
                                {t('side_panel.notification_center.title')}
                                {unseenCount ? (
                                    <Badge
                                        variant="default"
                                        className="h-5 min-w-5 justify-center px-1.5 tabular-nums"
                                    >
                                        {unseenCount}
                                    </Badge>
                                ) : null}
                            </SheetTitle>
                            <div className="flex items-center gap-0.5">
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t(
                                                    'side_panel.notification_center.mark_all_read'
                                                )}
                                                disabled={unseenCount <= 0}
                                                onClick={markAllRead}
                                            >
                                                <CheckCheckIcon data-icon="inline-start" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {t(
                                            'side_panel.notification_center.mark_all_read'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label={t(
                                                    'view.notification.refresh_tooltip'
                                                )}
                                                disabled={
                                                    loadStatus === 'running'
                                                }
                                                onClick={() => {
                                                    refreshForCurrentUser().catch(
                                                        (error: unknown) => {
                                                            toast.add({
                                                                type: 'error',
                                                                title: userFacingErrorMessage(
                                                                    error,
                                                                    t(
                                                                        'host.vrc_notification_center.toast.failed_to_refresh_notifications'
                                                                    )
                                                                )
                                                            });
                                                        }
                                                    );
                                                }}
                                            >
                                                {loadStatus === 'running' ? (
                                                    <Spinner data-icon="inline-start" />
                                                ) : (
                                                    <RefreshCcwIcon data-icon="inline-start" />
                                                )}
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('view.notification.refresh_tooltip')}
                                    </TooltipContent>
                                </Tooltip>
                                <SheetClose
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={t(
                                                'common.actions.close'
                                            )}
                                        />
                                    }
                                >
                                    <XIcon data-icon="inline-start" />
                                </SheetClose>
                            </div>
                        </div>
                        {detail ? (
                            <div className="text-muted-foreground text-xs">
                                {userFacingErrorMessage(
                                    detail,
                                    t(
                                        'view.notifications.toast.failed_to_load_notifications'
                                    )
                                )}
                            </div>
                        ) : null}
                    </SheetHeader>
                    <NotificationDrawerList
                        categories={categories}
                        currentUserId={currentUserId ?? undefined}
                        canInviteFromCurrentLocation={
                            canInviteFromCurrentLocation
                        }
                        handlers={{
                            onAcceptFriendRequest: acceptFriendRequest,
                            onAcceptRequestInvite: acceptRequestInvite,
                            onSendInviteResponseWithMessage:
                                sendInviteResponseWithMessage,
                            onSendNotificationResponse:
                                sendNotificationResponse,
                            onHideNotification: hideNotification,
                            onIgnoreNotificationLocally:
                                ignoreNotificationLocally,
                            onDeleteNotification: deleteNotification,
                            onMarkSeen: markSeen,
                            onJoinQueueReady: joinQueueReady
                        }}
                        onNavigateToTable={navigateToTable}
                    />
                </SheetContent>
            </Sheet>
            <InviteMessageDialog
                open={Boolean(inviteResponseRequest)}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setInviteResponseRequest(null);
                    }
                }}
                currentUserId={currentUserId}
                endpoint={endpoint}
                messageType={inviteResponseRequest?.messageType || 'response'}
                mode="respond"
                targetLabel={String(
                    inviteResponseRequest?.notification?.senderUsername ||
                        inviteResponseRequest?.notification?.senderUserId ||
                        'this user'
                )}
                allowEdit
                allowImageUpload={false}
                onUse={(
                    payload: Omit<InviteResponseSlotPayload, 'notification'>
                ) => {
                    if (!inviteResponseRequest) {
                        return undefined;
                    }
                    return sendInviteResponseSlot({
                        ...payload,
                        notification: inviteResponseRequest.notification
                    });
                }}
            />
            <BoopReplyDialog
                request={boopReplyRequest}
                isLocalUserVrcPlusSupporter={isLocalUserVrcPlusSupporter}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setBoopReplyRequest(null);
                    }
                }}
                onSend={sendBoopReply}
            />
        </>
    );
}
