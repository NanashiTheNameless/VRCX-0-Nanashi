import { useQuery } from '@tanstack/react-query';
import { EyeIcon, ImageIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import {
    Fragment,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import { TranslatableText } from '@/components/translation/TranslatableText';
import type {
    GroupGalleryPhotoRow,
    GroupPostRecord,
    GroupProfileRecord
} from '@/domain/entities/group';
import {
    formatDateFilter,
    formatDateTime,
    formatRelativeTime
} from '@/lib/dateTime';
import { entityQueryPolicies, queryKeys } from '@/lib/entityQueryCache';
import { useKnownUserFact } from '@/lib/useKnownUser';
import { cn } from '@/lib/utils';
import userProfileRepository from '@/repositories/userProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import {
    displayDayKey,
    parseAbsoluteDateMs
} from '@/shared/utils/displayTimeZone';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    getGroupRoleNameMap,
    getGroupRowImage,
    getGroupRowLabel,
    getGroupRowRawImage,
    groupRowsEmptyTitle
} from './groupDialogUtils';
import { GroupListState } from './GroupListState';

type GroupPostAction = (post: GroupPostRecord) => void;

interface RowListActions {
    onPreviewImage?: (url: string, title: string) => void;
    onEditPost?: GroupPostAction;
    onDeletePost?: GroupPostAction;
}

type RowListBaseProps = RowListActions & {
    group?: GroupProfileRecord | null;
    loading?: boolean;
    error?: string;
};

type RowListProps =
    | (RowListBaseProps & {
          kind: 'posts';
          rows: GroupPostRecord[];
          canManagePosts?: boolean;
      })
    | (RowListBaseProps & { kind: 'photos'; rows: GroupGalleryPhotoRow[] });

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

export function GroupPostUserButton({
    userId,
    displayName: providedDisplayName,
    label
}: {
    userId: string;
    displayName?: string;
    label?: ReactNode;
}) {
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const knownUser = useKnownUserFact(userId, {
        endpoint: currentEndpoint
    });
    const cachedDisplayName = text(
        providedDisplayName ||
            knownUser?.displayName ||
            knownUser?.username ||
            knownUser?.name
    );
    const userProfileQuery = useQuery({
        queryKey: queryKeys.user(userId, currentEndpoint),
        queryFn: () => userProfileRepository.getUserProfile({ userId }),
        enabled: Boolean(
            userId && (!cachedDisplayName || cachedDisplayName === userId)
        ),
        staleTime: entityQueryPolicies.userAvatarLookup.staleTime,
        gcTime: entityQueryPolicies.userAvatarLookup.gcTime,
        retry: entityQueryPolicies.userAvatarLookup.retry,
        refetchOnWindowFocus:
            entityQueryPolicies.userAvatarLookup.refetchOnWindowFocus
    });
    const queriedUser = userProfileQuery.data;
    const displayName = text(
        queriedUser?.displayName ||
            queriedUser?.username ||
            queriedUser?.name ||
            cachedDisplayName
    );

    if (!displayName || displayName === userId) {
        return null;
    }

    return (
        <Button
            type="button"
            variant="ghost"
            className="h-auto max-w-full justify-start gap-1 p-0 text-left text-xs hover:bg-transparent"
            onClick={() =>
                openUserDialog({
                    userId,
                    title: displayName,
                    seedData: queriedUser || knownUser || null
                })
            }
        >
            {label}
            <span className="text-foreground truncate font-medium">
                {displayName}
            </span>
        </Button>
    );
}

const POST_EDIT_THRESHOLD_MS = 60_000;

function timestampMs(value: unknown) {
    const ms = parseAbsoluteDateMs(value);
    return Number.isNaN(ms) ? null : ms;
}

function postDayKey(value: unknown) {
    return displayDayKey(value);
}

function PostBody({
    text: body,
    defaultExpanded
}: {
    text: string;
    defaultExpanded: boolean;
}) {
    const { t } = useTranslation();
    const ref = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [overflowing, setOverflowing] = useState(false);

    useLayoutEffect(() => {
        const element = ref.current;
        if (element && !expanded) {
            setOverflowing(element.scrollHeight > element.clientHeight + 1);
        }
    }, [body, expanded]);

    return (
        <>
            <p
                ref={ref}
                className={cn(
                    'text-muted-foreground mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap',
                    !expanded && 'line-clamp-4'
                )}
            >
                {body}
            </p>
            {overflowing ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground group-hover/post:text-foreground mt-1 -ml-2 hover:bg-transparent"
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded
                        ? t('dialog.group.posts.collapse')
                        : t('dialog.group.posts.expand')}
                </Button>
            ) : null}
        </>
    );
}

function PostCard({
    post,
    rolesById,
    canManagePosts,
    onPreviewImage,
    onEditPost,
    onDeletePost
}: RowListActions & {
    post: GroupPostRecord;
    rolesById: Map<string, string>;
    canManagePosts: boolean;
}) {
    const { t } = useTranslation();
    const image = getGroupRowRawImage(post);
    const title = post.title || 'Post';
    const roleNames = (post.roleIds ?? []).map(
        (roleId) => rolesById.get(roleId) || roleId
    );
    const createdMs = timestampMs(post.createdAt);
    const updatedMs = timestampMs(post.updatedAt);
    const edited =
        createdMs !== null &&
        updatedMs !== null &&
        updatedMs - createdMs > POST_EDIT_THRESHOLD_MS;

    return (
        <TranslatableText
            source={post.text || ''}
            entityId={post.id || ''}
            density="icon"
        >
            {({ action, meta, error, text: body, isTranslated }) => (
                <article className="bg-card hover:border-foreground/20 group/post rounded-lg border px-4 py-3 transition-colors">
                    <div className="text-muted-foreground flex min-w-0 items-center gap-x-2 text-xs">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            {post.authorId ? (
                                <GroupPostUserButton
                                    userId={post.authorId}
                                    displayName={post.authorDisplayName}
                                />
                            ) : null}
                            {post.createdAt ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span>
                                                {formatRelativeTime(
                                                    post.createdAt
                                                )}
                                            </span>
                                        }
                                    />
                                    <TooltipContent>
                                        {formatDateFilter(
                                            post.createdAt,
                                            'long'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {edited ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span>
                                                -{' '}
                                                {t('dialog.group.posts.edited')}
                                            </span>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('dialog.group.posts.edited_at')}
                                        {formatDateFilter(
                                            post.updatedAt,
                                            'long'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            {edited &&
                            post.editorId &&
                            post.editorId !== post.authorId ? (
                                <GroupPostUserButton
                                    userId={post.editorId}
                                    displayName={post.editorDisplayName}
                                    label={
                                        <span>
                                            {t('dialog.group.posts.edited_by')}
                                        </span>
                                    }
                                />
                            ) : null}
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                            {roleNames.length ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Badge
                                                variant="outline"
                                                className="max-w-48"
                                            >
                                                <EyeIcon data-icon="inline-start" />
                                                <span className="truncate">
                                                    {roleNames.join(', ')}
                                                </span>
                                            </Badge>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('dialog.group.posts.visibility')}
                                        {roleNames.join(', ')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            <div className="flex items-center opacity-0 transition-opacity group-focus-within/post:opacity-100 group-hover/post:opacity-100">
                                {action}
                                {canManagePosts ? (
                                    <>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label={t(
                                                'common.actions.edit'
                                            )}
                                            onClick={() => onEditPost?.(post)}
                                        >
                                            <PencilIcon />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            className="text-destructive"
                                            aria-label={t(
                                                'common.actions.delete'
                                            )}
                                            onClick={() => onDeletePost?.(post)}
                                        >
                                            <Trash2Icon />
                                        </Button>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="mt-2 flex gap-3">
                        <div className="min-w-0 flex-1">
                            <h4 className="text-foreground text-[15px] leading-snug font-medium break-words">
                                {title}
                            </h4>
                            {body ? (
                                <>
                                    {meta ? (
                                        <div className="mt-1">{meta}</div>
                                    ) : null}
                                    <PostBody
                                        key={
                                            isTranslated
                                                ? 'translated'
                                                : 'original'
                                        }
                                        text={body}
                                        defaultExpanded={isTranslated}
                                    />
                                </>
                            ) : null}
                            {error}
                        </div>
                        {image ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto shrink-0 self-start p-0"
                                aria-label={t('accessibility.preview_image', {
                                    item: title
                                })}
                                onClick={() => onPreviewImage?.(image, title)}
                            >
                                <FadeInImage
                                    src={convertFileUrlToImageUrl(image, 256)}
                                    alt=""
                                    className="size-24 rounded-md border object-cover"
                                />
                            </Button>
                        ) : null}
                    </div>
                </article>
            )}
        </TranslatableText>
    );
}

function PostList({
    rows,
    group,
    onPreviewImage,
    canManagePosts,
    onEditPost,
    onDeletePost
}: RowListActions & {
    rows: GroupPostRecord[];
    group: GroupProfileRecord | null;
    canManagePosts: boolean;
}) {
    usePreferencesStore((state) => state.dtTimeZone);
    const rolesById = getGroupRoleNameMap(group);
    return (
        <div className="flex flex-col gap-2.5">
            {rows.map((post, index) => {
                const dayKey = postDayKey(post.createdAt);
                const showDay =
                    dayKey !== '' &&
                    dayKey !== postDayKey(rows[index - 1]?.createdAt);
                return (
                    <Fragment key={post.id || `${post.title}:${index}`}>
                        {showDay ? (
                            <div className="text-muted-foreground mt-1.5 flex items-center gap-3 px-0.5 text-xs first:mt-0">
                                <span>
                                    {formatDateTime(post.createdAt, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </span>
                                <Separator className="flex-1" />
                            </div>
                        ) : null}
                        <PostCard
                            post={post}
                            rolesById={rolesById}
                            canManagePosts={canManagePosts}
                            onPreviewImage={onPreviewImage}
                            onEditPost={onEditPost}
                            onDeletePost={onDeletePost}
                        />
                    </Fragment>
                );
            })}
        </div>
    );
}

type GalleryEntry = {
    gallery: { id: string; name: string; description?: string };
    rows: GroupGalleryPhotoRow[];
};

function PhotoGalleryRows({
    rows,
    loading,
    error,
    onPreviewImage
}: RowListActions & {
    rows: GroupGalleryPhotoRow[];
    loading: boolean;
    error: string;
}) {
    const { t } = useTranslation();

    const groups = new Map<string, GalleryEntry>();
    for (const row of rows) {
        const galleryId = text(row.$galleryId) || 'gallery';
        if (!groups.has(galleryId)) {
            groups.set(galleryId, {
                gallery: {
                    id: galleryId,
                    name: text(row.$galleryName) || 'Gallery'
                },
                rows: []
            });
        }
        groups.get(galleryId)?.rows.push(row);
    }
    const galleryEntries = Array.from(groups.values());
    const [activeGallery, setActiveGallery] = useState(
        galleryEntries[0]?.gallery?.id || ''
    );

    useEffect(() => {
        if (
            galleryEntries.length &&
            !galleryEntries.some((entry) => entry.gallery.id === activeGallery)
        ) {
            setActiveGallery(galleryEntries[0].gallery.id);
        }
    }, [activeGallery, galleryEntries]);

    if (loading) {
        return (
            <GroupListState title={t('dialog.group.gallery.header')} loading />
        );
    }
    if (error) {
        return (
            <GroupListState
                title={t('dialog.group.gallery.header')}
                error={error}
            />
        );
    }
    if (!galleryEntries.length) {
        return <GroupListState title={t('dialog.group.gallery.header')} />;
    }

    return (
        <Tabs
            value={activeGallery}
            onValueChange={setActiveGallery}
            className="gap-2"
        >
            <TabsList className="max-w-full justify-start overflow-x-auto">
                {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                    <TabsTrigger
                        key={gallery.id}
                        value={gallery.id}
                        className="flex-none px-3"
                    >
                        <span className="font-bold">
                            {gallery.name || 'Gallery'}
                        </span>
                        <span className="text-muted-foreground ml-1.5 text-xs">
                            {galleryRows.length}
                        </span>
                    </TabsTrigger>
                ))}
            </TabsList>
            {galleryEntries.map(({ gallery, rows: galleryRows }) => (
                <TabsContent
                    key={gallery.id}
                    value={gallery.id}
                    className="m-0"
                >
                    {gallery.description ? (
                        <div className="text-muted-foreground px-2 py-1 text-sm">
                            {gallery.description}
                        </div>
                    ) : null}
                    <div className="grid max-h-[60vh] gap-4 overflow-y-auto p-1 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                        {galleryRows.map((row, index) => {
                            const image = getGroupRowImage(row, 'photos');
                            return (
                                <Button
                                    key={`${getGroupRowLabel(row)}:${index}`}
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full flex-col items-stretch overflow-hidden rounded-md border p-0 text-left text-sm"
                                    onClick={() =>
                                        onPreviewImage?.(
                                            getGroupRowRawImage(row),
                                            getGroupRowLabel(row)
                                        )
                                    }
                                >
                                    {image ? (
                                        <FadeInImage
                                            src={image}
                                            alt={getGroupRowLabel(row)}
                                            className="max-h-52 w-full object-contain"
                                        />
                                    ) : (
                                        <div className="bg-muted flex h-52 w-full items-center justify-center">
                                            <ImageIcon className="text-muted-foreground" />
                                        </div>
                                    )}
                                </Button>
                            );
                        })}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
}

export function RowList(props: RowListProps) {
    const { kind, loading = false, error = '' } = props;
    if (loading) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} loading />;
    }
    if (error) {
        return (
            <GroupListState title={groupRowsEmptyTitle(kind)} error={error} />
        );
    }
    if (props.kind === 'photos') {
        return (
            <PhotoGalleryRows
                rows={props.rows}
                loading={loading}
                error={error}
                onPreviewImage={props.onPreviewImage}
            />
        );
    }
    if (!props.rows.length) {
        return <GroupListState title={groupRowsEmptyTitle(kind)} />;
    }
    if (props.kind === 'posts') {
        return (
            <PostList
                rows={props.rows}
                group={props.group ?? null}
                onPreviewImage={props.onPreviewImage}
                canManagePosts={props.canManagePosts ?? false}
                onEditPost={props.onEditPost}
                onDeletePost={props.onDeletePost}
            />
        );
    }

    return null;
}
