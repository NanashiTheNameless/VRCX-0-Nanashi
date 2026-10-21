import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/layout/PageScaffold';
import { VrcPlusLockedNotice } from '@/components/media/VrcPlusLockedNotice';
import { SelectableTile } from '@/components/tile/SelectableTile';
import vrchatMediaRepository from '@/repositories/vrchatMediaRepository';
import { toast } from '@/services/toastService';
import {
    isProfileMediaFileUsableWithoutVrcPlus,
    type ProfileMediaField
} from '@/shared/utils/currentUserMedia';
import { convertFileUrlToImageUrl } from '@/shared/utils/entityMedia';
import { extractFileId } from '@/shared/utils/fileUtils';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import { getLatestFileUrl, type MediaFile } from '../../ProfileMediaPanel';
import { resolveUserDialogBannerColor } from '../userDialogProfileAppearance';
import type { UserDialogProfileRecord } from '../userDialogProfileTypes';

const DEFAULT_BANNER_COLOR = '#2cc968';
const AVATAR_PENDING_KEY = 'avatar';
const COLOR_PENDING_KEY = 'color';

function resolveCurrentSelection(
    field: ProfileMediaField,
    profile: UserDialogProfileRecord
) {
    if (field === 'userIcon') {
        const fileId = extractFileId(
            typeof profile.userIcon === 'string' ? profile.userIcon : ''
        );
        return { fileId, avatar: !fileId, color: '' };
    }
    const color = resolveUserDialogBannerColor(profile);
    const fileId =
        color || profile.bannerType === 'avatarBanner'
            ? ''
            : extractFileId(
                  typeof profile.bannerCustomUrl === 'string'
                      ? profile.bannerCustomUrl
                      : ''
              );
    return { fileId, avatar: !color && !fileId, color };
}

export function UserProfileMediaPicker({
    field,
    profile,
    isVrcPlus,
    busy,
    onSetFile,
    onSetBannerColor
}: {
    field: ProfileMediaField;
    profile: UserDialogProfileRecord;
    isVrcPlus: boolean;
    busy: boolean;
    onSetFile: (field: ProfileMediaField, fileId: string) => Promise<unknown>;
    onSetBannerColor: (hexColor: string) => Promise<unknown>;
}) {
    const { t } = useTranslation();
    const [files, setFiles] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [pendingKey, setPendingKey] = useState('');
    const current = resolveCurrentSelection(field, profile);
    const [colorDraft, setColorDraft] = useState(
        current.color || DEFAULT_BANNER_COLOR
    );
    const [showColorEditor, setShowColorEditor] = useState(
        Boolean(current.color)
    );
    const isBanner = field === 'banner';
    const pending = busy || Boolean(pendingKey);
    const isLocked = (file: MediaFile) =>
        !isVrcPlus && !isProfileMediaFileUsableWithoutVrcPlus(field, file);
    const hasLockedFiles = files.some(isLocked);
    const vrcPlusHint = t('dialog.inventory.requires_vrc_plus');
    const aspectClassName = isBanner ? 'aspect-[4/3]' : 'aspect-square';
    const avatarImageUrl = convertFileUrlToImageUrl(
        isBanner
            ? profile.currentAvatarImageUrl
            : profile.currentAvatarThumbnailImageUrl,
        512
    );

    useEffect(() => {
        let active = true;
        setLoading(true);
        vrchatMediaRepository
            .getFileList({ n: 100, tag: isBanner ? 'gallery' : 'icon' })
            .then(({ json }) => {
                if (active) {
                    setFiles(Array.isArray(json) ? [...json].reverse() : []);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t('view.tools.toast.failed_to_load_value', {
                                      value: field
                                  })
                    });
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
    }, [field, isBanner, t]);

    async function run(key: string, task: () => Promise<unknown>) {
        setPendingKey(key);
        try {
            await task();
        } finally {
            setPendingKey('');
        }
    }

    return (
        <div className="flex flex-col gap-3">
            {hasLockedFiles ? <VrcPlusLockedNotice /> : null}
            {isBanner && showColorEditor ? (
                <div className="border-border bg-muted/20 flex flex-wrap items-center gap-2 rounded-lg border p-2">
                    <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
                        <span className="text-muted-foreground">
                            {t('dialog.user.profile_edit.solid_color')}
                        </span>
                        <Input
                            type="color"
                            value={colorDraft}
                            disabled={pending}
                            onChange={(event) =>
                                setColorDraft(event.target.value)
                            }
                            className="size-8 shrink-0 cursor-pointer p-0.5"
                        />
                    </label>
                    <Button
                        type="button"
                        size="sm"
                        className="ms-auto"
                        disabled={pending || colorDraft === current.color}
                        onClick={() =>
                            run(COLOR_PENDING_KEY, () =>
                                onSetBannerColor(colorDraft)
                            )
                        }
                    >
                        {t('dialog.user.profile_edit.apply_color')}
                    </Button>
                </div>
            ) : null}
            <div
                className={
                    isBanner
                        ? 'grid grid-cols-2 gap-2 sm:grid-cols-3'
                        : 'grid grid-cols-3 gap-2 sm:grid-cols-4'
                }
            >
                <SelectableTile
                    label={t('dialog.user.profile_edit.avatar_image')}
                    showLabel
                    imageUrl={avatarImageUrl}
                    imageClassName="size-full object-cover"
                    aspectClassName={aspectClassName}
                    isCurrent={current.avatar}
                    busy={pendingKey === AVATAR_PENDING_KEY}
                    inert={pending || current.avatar}
                    onClick={() => {
                        setShowColorEditor(false);
                        run(AVATAR_PENDING_KEY, () => onSetFile(field, ''));
                    }}
                />
                {isBanner ? (
                    <SelectableTile
                        label={t('dialog.user.profile_edit.solid_color')}
                        showLabel
                        fallbackIcon={false}
                        previewStyle={{ backgroundColor: colorDraft }}
                        aspectClassName={aspectClassName}
                        isCurrent={
                            Boolean(current.color) &&
                            colorDraft === current.color
                        }
                        busy={pendingKey === COLOR_PENDING_KEY}
                        inert={pending}
                        onClick={() => setShowColorEditor(true)}
                    />
                ) : null}
                {loading
                    ? null
                    : files.map((file) => {
                          const locked = isLocked(file);
                          const isCurrent = current.fileId === file.id;
                          return (
                              <SelectableTile
                                  key={file.id}
                                  label={
                                      locked
                                          ? vrcPlusHint
                                          : isBanner
                                            ? t(
                                                  'dialog.gallery_icons.use_banner'
                                              )
                                            : t(
                                                  'dialog.gallery_icons.use_profile_icon'
                                              )
                                  }
                                  imageUrl={getLatestFileUrl(file)}
                                  imageClassName="size-full object-cover"
                                  aspectClassName={aspectClassName}
                                  isCurrent={isCurrent}
                                  locked={locked}
                                  showLockIcon
                                  busy={pendingKey === file.id}
                                  inert={pending || locked || isCurrent}
                                  onClick={() => {
                                      setShowColorEditor(false);
                                      run(file.id, () =>
                                          onSetFile(field, file.id)
                                      );
                                  }}
                              />
                          );
                      })}
            </div>
            {loading ? <LoadingState className="min-h-32" /> : null}
        </div>
    );
}
