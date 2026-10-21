import { ImageIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { cn } from '@/lib/utils';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';

import { getGroupRowImage, getGroupRowLabel } from './groupDialogUtils';
import { GroupListState } from './GroupListState';

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function GroupGalleryImageField({
    id,
    open,
    imageId,
    disabled,
    onChange
}: {
    id: string;
    open: boolean;
    imageId: string;
    disabled: boolean;
    onChange: (imageId: string) => void;
}) {
    const { t } = useTranslation();
    const [galleryRows, setGalleryRows] = useState<
        Awaited<ReturnType<typeof vrchatMediaRepository.getFileList>>['json']
    >([]);
    const [galleryStatus, setGalleryStatus] = useState('idle');
    const [galleryError, setGalleryError] = useState('');
    const galleryRequestIdRef = useRef(0);

    const loadGalleryRows = useCallback(async () => {
        if (!open) {
            return;
        }
        const requestId = galleryRequestIdRef.current + 1;
        galleryRequestIdRef.current = requestId;
        setGalleryStatus('running');
        setGalleryError('');
        try {
            const response = await vrchatMediaRepository.getFileList({
                n: 100,
                tag: 'gallery'
            });
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows(
                Array.isArray(response.json) ? [...response.json].reverse() : []
            );
            setGalleryStatus('ready');
        } catch (error) {
            if (galleryRequestIdRef.current !== requestId) {
                return;
            }
            setGalleryRows([]);
            setGalleryStatus('error');
            setGalleryError(
                error instanceof Error
                    ? error.message
                    : 'Failed to load gallery images.'
            );
        }
    }, [open]);

    useEffect(() => {
        if (open) {
            loadGalleryRows();
        } else {
            galleryRequestIdRef.current += 1;
            setGalleryRows([]);
            setGalleryStatus('idle');
            setGalleryError('');
        }
    }, [loadGalleryRows, open]);

    const galleryOptions = galleryRows
        .map((row) => ({
            id: text(row?.id || row?.fileId || row?.file_id),
            label: getGroupRowLabel(row),
            image: getGroupRowImage(row, 'gallery')
        }))
        .filter((option) => option.id);

    return (
        <Field>
            <FieldLabel htmlFor={id}>{t('table.import.image')}</FieldLabel>
            <InputGroup>
                <InputGroupInput
                    id={id}
                    value={imageId}
                    onChange={(event) => onChange(event.target.value)}
                    disabled={disabled}
                    placeholder={t('dialog.group.label.gallery_image_id')}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        type="button"
                        disabled={disabled || !imageId}
                        onClick={() => onChange('')}
                    >
                        {t('common.actions.clear')}
                    </InputGroupButton>
                    <InputGroupButton
                        type="button"
                        disabled={disabled || galleryStatus === 'running'}
                        onClick={() => {
                            loadGalleryRows();
                        }}
                    >
                        {t('common.actions.refresh')}
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            {galleryOptions.length ? (
                <div className="grid max-h-56 grid-cols-4 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-6">
                    {galleryOptions.map((option) => (
                        <Button
                            key={option.id}
                            type="button"
                            variant="outline"
                            disabled={disabled}
                            aria-label={option.label}
                            aria-pressed={imageId === option.id}
                            className={cn(
                                'aspect-square h-auto w-full min-w-0 overflow-hidden p-0',
                                imageId === option.id &&
                                    'border-primary border-2'
                            )}
                            onClick={() => onChange(option.id)}
                        >
                            {option.image ? (
                                <FadeInImage
                                    src={option.image}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            ) : (
                                <ImageIcon className="text-muted-foreground" />
                            )}
                        </Button>
                    ))}
                </div>
            ) : (
                <GroupListState
                    title={t('dialog.group.empty.no_gallery_images')}
                    description={t(
                        'dialog.group.action.refresh_to_load_gallery_images'
                    )}
                    loading={galleryStatus === 'running'}
                    error={galleryError}
                    className="min-h-24 p-3"
                />
            )}
        </Field>
    );
}
