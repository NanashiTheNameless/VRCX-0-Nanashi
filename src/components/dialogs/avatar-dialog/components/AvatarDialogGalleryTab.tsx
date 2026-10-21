import { ImageIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type { LoadStatus } from '@/domain/shared/types';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid
} from '../../EntityDialogScaffold';
import type {
    AvatarActionStatus,
    AvatarGalleryEntry
} from '../avatarDialogTypes';

export function AvatarDialogGalleryTab({
    canManageAvatar,
    actionStatus,
    galleryStatus,
    media,
    onOpenGalleryPreview,
    onGalleryIndexChange,
    onUploadGallery,
    onMoveGalleryImage,
    onDeleteGalleryImage
}: {
    canManageAvatar: boolean;
    actionStatus: AvatarActionStatus;
    galleryStatus: LoadStatus;
    media: {
        galleryImages: AvatarGalleryEntry[];
        currentGalleryImage: string;
        galleryIndex: number;
    };
    onOpenGalleryPreview(): void;
    onGalleryIndexChange(updater: (currentIndex: number) => number): void;
    onUploadGallery(): void;
    onMoveGalleryImage(direction: -1 | 1): void;
    onDeleteGalleryImage(): void;
}) {
    const { t } = useTranslation();
    const { galleryImages, currentGalleryImage, galleryIndex } = media;
    const galleryEditDisabled = actionStatus !== 'idle';

    return (
        <EntityDialogTabContent value="gallery" forceMount>
            <EntityInfoGrid>
                <EntityInfoBlock label={t('dialog.avatar.info.gallery')} full>
                    <div className="mt-2 flex w-full flex-col gap-2">
                        {canManageAvatar ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                    actionStatus === 'gallery-upload' ||
                                    galleryStatus === 'idle' ||
                                    galleryStatus === 'running'
                                }
                                onClick={onUploadGallery}
                            >
                                <UploadIcon data-icon="inline-start" />
                                {t('dialog.screenshot_metadata.upload')}
                            </Button>
                        ) : null}
                        {galleryStatus === 'idle' ||
                        galleryStatus === 'running' ? (
                            <div className="text-muted-foreground flex min-h-24 items-center justify-center rounded-md border border-dashed">
                                <Spinner aria-label={t('common.loading')} />
                            </div>
                        ) : galleryImages.length ? (
                            <div className="flex flex-col gap-2">
                                <div className="relative">
                                    <Button
                                        type="button"
                                        disabled={!currentGalleryImage}
                                        variant="outline"
                                        className="bg-muted/20 h-52 w-full overflow-hidden p-0"
                                        onClick={onOpenGalleryPreview}
                                    >
                                        {currentGalleryImage ? (
                                            <FadeInImage
                                                src={currentGalleryImage}
                                                alt=""
                                                className="size-full object-contain"
                                            />
                                        ) : (
                                            <span className="text-muted-foreground flex size-full items-center justify-center [&>svg]:size-8">
                                                <ImageIcon />
                                            </span>
                                        )}
                                    </Button>
                                    {canManageAvatar ? (
                                        <div className="bg-background/85 absolute top-2 right-2 flex items-center gap-1 rounded-md border p-1 shadow-sm">
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                disabled={
                                                    galleryEditDisabled ||
                                                    galleryIndex === 0
                                                }
                                                onClick={() =>
                                                    onMoveGalleryImage(-1)
                                                }
                                            >
                                                {t(
                                                    'dialog.avatar.info.gallery_move_earlier'
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="xs"
                                                variant="ghost"
                                                disabled={
                                                    galleryEditDisabled ||
                                                    galleryIndex >=
                                                        galleryImages.length - 1
                                                }
                                                onClick={() =>
                                                    onMoveGalleryImage(1)
                                                }
                                            >
                                                {t(
                                                    'dialog.avatar.info.gallery_move_later'
                                                )}
                                            </Button>
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            type="button"
                                                            aria-label={t(
                                                                'dialog.avatar.info.gallery_delete_image'
                                                            )}
                                                            size="icon-xs"
                                                            variant="ghost"
                                                            disabled={
                                                                galleryEditDisabled
                                                            }
                                                            onClick={
                                                                onDeleteGalleryImage
                                                            }
                                                        >
                                                            <Trash2Icon />
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    {t(
                                                        'dialog.avatar.info.gallery_delete_image'
                                                    )}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={galleryImages.length <= 1}
                                        onClick={() =>
                                            onGalleryIndexChange(
                                                (currentIndex) =>
                                                    (currentIndex +
                                                        galleryImages.length -
                                                        1) %
                                                    galleryImages.length
                                            )
                                        }
                                    >
                                        {t('table.pagination.previous')}
                                    </Button>
                                    <span>
                                        {galleryIndex + 1} /{' '}
                                        {galleryImages.length}
                                    </span>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={galleryImages.length <= 1}
                                        onClick={() =>
                                            onGalleryIndexChange(
                                                (currentIndex) =>
                                                    (currentIndex + 1) %
                                                    galleryImages.length
                                            )
                                        }
                                    >
                                        {t('table.pagination.next')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted-foreground rounded-md border border-dashed p-4 text-xs">
                                {t('dialog.avatar.empty.no_gallery_images')}
                            </div>
                        )}
                    </div>
                </EntityInfoBlock>
            </EntityInfoGrid>
        </EntityDialogTabContent>
    );
}
