import { ArrowLeftIcon } from 'lucide-react';
import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { FORK_DEVELOPER_USER_ID } from '@/shared/constants/user';
import { useDialogStore } from '@/state/dialogStore';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator
} from '@/ui/shadcn/breadcrumb';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';

const AvatarDialogContent = lazy(() =>
    import('@/components/dialogs/AvatarDialogContent').then((module) => ({
        default: module.AvatarDialogContent
    }))
);
const GroupDialogContent = lazy(() =>
    import('@/components/dialogs/GroupDialogContent').then((module) => ({
        default: module.GroupDialogContent
    }))
);
const UserDialogContent = lazy(() =>
    import('@/components/dialogs/UserDialogContent').then((module) => ({
        default: module.UserDialogContent
    }))
);
const WorldDialogContent = lazy(() =>
    import('@/components/dialogs/WorldDialogContent').then((module) => ({
        default: module.WorldDialogContent
    }))
);

export function DialogHost() {
    const { t } = useTranslation();
    const activeDialog = useDialogStore((state) => state.activeDialog);
    const breadcrumbs = useDialogStore((state) => state.breadcrumbs);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const popToBreadcrumb = useDialogStore((state) => state.popToBreadcrumb);
    const [retainedPresentation, setRetainedPresentation] = useState({
        activeDialog,
        breadcrumbs
    });

    const renderedDialog = activeDialog ?? retainedPresentation.activeDialog;
    const renderedBreadcrumbs = activeDialog
        ? breadcrumbs
        : retainedPresentation.breadcrumbs;

    useEffect(() => {
        if (activeDialog) {
            setRetainedPresentation({ activeDialog, breadcrumbs });
        }
    }, [activeDialog, breadcrumbs]);

    const currentBreadcrumbIndex = renderedBreadcrumbs.length - 1;
    const dialogKind = renderedDialog?.kind || '';
    const dialogPayload = renderedDialog?.payload || null;
    const isUserDialog = dialogKind === 'user';
    const isForkMaintainerDialog =
        isUserDialog && renderedDialog?.entityId === FORK_DEVELOPER_USER_ID;
    const isWorldDialog = dialogKind === 'world';
    const isAvatarDialog = dialogKind === 'avatar';
    const isGroupDialog = dialogKind === 'group';
    const defaultTitle = isUserDialog
        ? 'User'
        : isWorldDialog
          ? 'World'
          : isAvatarDialog
            ? 'Avatar'
            : isGroupDialog
              ? 'Group'
              : 'Dialog host';
    const defaultDescription = isUserDialog
        ? 'Live user profile summary from the current session and VRChat API.'
        : isWorldDialog
          ? 'Live world profile summary from the current session and VRChat API.'
          : isAvatarDialog
            ? 'Live avatar profile summary from the current session, local cache, and VRChat API.'
            : isGroupDialog
              ? 'Live group profile summary from the current session and VRChat API.'
              : 'Unsupported dialog type.';

    return (
        <Dialog
            open={Boolean(activeDialog)}
            onOpenChange={(open, eventDetails) => {
                if (open) {
                    return;
                }
                if (
                    eventDetails.reason === 'escape-key' &&
                    currentBreadcrumbIndex > 0
                ) {
                    eventDetails.cancel();
                    popToBreadcrumb(currentBreadcrumbIndex - 1);
                    return;
                }
                closeDialog();
            }}
            onOpenChangeComplete={(open) => {
                if (!open && !useDialogStore.getState().activeDialog) {
                    setRetainedPresentation({
                        activeDialog: null,
                        breadcrumbs: []
                    });
                }
            }}
        >
            <DialogContent
                showCloseButton={false}
                className={cn(
                    'flex max-h-[90vh] w-[calc(100vw-2rem)] !max-w-[calc(100vw-2rem)] flex-col overflow-hidden',
                    isUserDialog ||
                        isWorldDialog ||
                        isGroupDialog ||
                        isAvatarDialog
                        ? 'entity-dialog bg-(--entity-dialog-ground) sm:w-[min(96vw,72rem)] sm:!max-w-[min(96vw,72rem)]'
                        : 'sm:w-[65rem] sm:!max-w-[65rem]',
                    isForkMaintainerDialog && 'fork-maintainer-dialog dark'
                )}
            >
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {renderedDialog?.title ?? defaultTitle}
                    </DialogTitle>
                    <DialogDescription>
                        {renderedDialog?.description ?? defaultDescription}
                    </DialogDescription>
                </DialogHeader>
                {currentBreadcrumbIndex > 0 ? (
                    <div className="flex min-w-0 items-center gap-1.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.actions.back')}
                            onClick={() =>
                                popToBreadcrumb(currentBreadcrumbIndex - 1)
                            }
                        >
                            <ArrowLeftIcon data-icon="inline-start" />
                        </Button>
                        <Breadcrumb className="min-w-0">
                            <BreadcrumbList>
                                {renderedBreadcrumbs.map((crumb, index) => (
                                    <Fragment
                                        key={`${crumb.key ?? crumb.label}-${index}`}
                                    >
                                        <BreadcrumbItem>
                                            {index < currentBreadcrumbIndex ? (
                                                <BreadcrumbLink
                                                    className="cursor-pointer"
                                                    onClick={() =>
                                                        popToBreadcrumb(index)
                                                    }
                                                >
                                                    {crumb.label ??
                                                        crumb.title ??
                                                        `Step ${index + 1}`}
                                                </BreadcrumbLink>
                                            ) : (
                                                <BreadcrumbPage>
                                                    {crumb.label ??
                                                        crumb.title ??
                                                        `Step ${index + 1}`}
                                                </BreadcrumbPage>
                                            )}
                                        </BreadcrumbItem>
                                        {index < currentBreadcrumbIndex ? (
                                            <BreadcrumbSeparator />
                                        ) : null}
                                    </Fragment>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                ) : null}
                <Suspense
                    fallback={<Spinner className="mx-auto my-8 size-6" />}
                >
                    {isUserDialog ? (
                        <UserDialogContent
                            key={`user:${renderedDialog?.entityId ?? ''}:${
                                renderedDialog?.openNonce ?? 0
                            }`}
                            userId={renderedDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                            initialAction={dialogPayload?.initialAction ?? ''}
                            openNonce={renderedDialog?.openNonce ?? 0}
                        />
                    ) : isWorldDialog ? (
                        <WorldDialogContent
                            worldId={renderedDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                            initialAction={dialogPayload?.initialAction ?? ''}
                            openNonce={renderedDialog?.openNonce ?? 0}
                            initialActionNonce={
                                dialogPayload?.initialActionNonce ?? 0
                            }
                            initialNewInstanceDefaults={
                                dialogPayload?.initialNewInstanceDefaults ??
                                null
                            }
                        />
                    ) : isAvatarDialog ? (
                        <AvatarDialogContent
                            avatarId={renderedDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                        />
                    ) : isGroupDialog ? (
                        <GroupDialogContent
                            groupId={renderedDialog?.entityId}
                            seedData={dialogPayload?.seedData ?? null}
                        />
                    ) : (
                        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                            {renderedDialog?.body ?? 'Unsupported dialog type.'}
                        </div>
                    )}
                </Suspense>
            </DialogContent>
        </Dialog>
    );
}
