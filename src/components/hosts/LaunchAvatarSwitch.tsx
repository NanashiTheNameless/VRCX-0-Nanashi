import { useQuery } from '@tanstack/react-query';
import { ChevronRightIcon, ImageIcon, InfoIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import myAvatarRepository from '@/repositories/myAvatarRepository';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { isRecord } from '@/shared/utils/record';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from '@/ui/shadcn/collapsible';
import {
    Combobox,
    ComboboxCollection,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxList,
    ComboboxTrigger,
    ComboboxValue
} from '@/ui/shadcn/combobox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type AvatarOption = {
    id: string;
    name: string;
    thumbnailUrl: string;
};

type AvatarOptionGroup = {
    value: 'current' | 'own' | 'favorite';
    items: string[];
};

function avatarOptionOf(value: unknown): AvatarOption | null {
    if (!isRecord(value) || typeof value.id !== 'string') {
        return null;
    }
    const id = value.id.trim();
    if (!id) {
        return null;
    }
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const thumbnail =
        typeof value.thumbnailImageUrl === 'string'
            ? value.thumbnailImageUrl
            : '';
    return {
        id,
        name: name || id,
        thumbnailUrl: convertFileUrlToImageUrl(thumbnail, 128)
    };
}

function AvatarThumbnail({
    url,
    className
}: {
    url: string;
    className: string;
}) {
    return (
        <Avatar className={`${className} shrink-0 rounded-md after:rounded-md`}>
            {url ? (
                <AvatarImage
                    src={url}
                    alt=""
                    loading="lazy"
                    className="rounded-md object-cover"
                />
            ) : null}
            <AvatarFallback className="rounded-md [&>svg]:size-3.5">
                <ImageIcon aria-hidden="true" />
            </AvatarFallback>
        </Avatar>
    );
}

function LaunchAvatarPicker({
    value,
    disabled,
    onValueChange
}: {
    value: string;
    disabled: boolean;
    onValueChange(avatarId: string): void;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentAvatarId = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatar?.trim() || ''
    );
    const currentAvatarName = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatarName || ''
    );
    const currentAvatarThumbnail = useRuntimeStore(
        (state) =>
            state.auth.currentUserSnapshot?.currentAvatarThumbnailImageUrl || ''
    );
    const favoriteAvatarIds = useFavoriteStore(
        (state) => state.favoriteAvatarIds
    );
    const favoriteAvatarGroups = useFavoriteStore(
        (state) => state.favoriteAvatarGroups
    );
    const avatarTags = useMemo(
        () =>
            favoriteAvatarGroups
                .map((group) => group.name?.trim() || '')
                .filter(Boolean),
        [favoriteAvatarGroups]
    );

    const ownAvatars = useQuery({
        queryKey: ['launch-avatar-switch', 'own', currentUserId, endpoint],
        enabled: Boolean(currentUserId),
        retry: false,
        staleTime: 60_000,
        queryFn: () => myAvatarRepository.getMyAvatars()
    });
    const favoriteAvatars = useQuery({
        queryKey: [
            'launch-avatar-switch',
            'favorite',
            currentUserId,
            endpoint,
            favoriteAvatarIds,
            avatarTags
        ],
        enabled: Boolean(currentUserId) && favoriteAvatarIds.length > 0,
        retry: false,
        staleTime: 60_000,
        queryFn: () =>
            commands.appFavoriteDetailsHydrate({
                kind: 'avatar',
                favoriteIds: favoriteAvatarIds,
                requestedIds: favoriteAvatarIds,
                avatarTags
            })
    });

    const { groups, optionsById } = useMemo(() => {
        const byId = new Map<string, AvatarOption>();
        const ownIds: string[] = [];
        for (const record of ownAvatars.data ?? []) {
            const option = avatarOptionOf(record);
            if (option && !byId.has(option.id)) {
                byId.set(option.id, option);
                ownIds.push(option.id);
            }
        }
        const favoriteIds: string[] = [];
        const detailsById = favoriteAvatars.data?.detailsById ?? {};
        for (const avatarId of favoriteAvatarIds) {
            const option = avatarOptionOf(detailsById[avatarId]);
            if (option && !byId.has(option.id)) {
                byId.set(option.id, option);
                favoriteIds.push(option.id);
            }
        }
        if (currentAvatarId) {
            const known = byId.get(currentAvatarId);
            byId.set(currentAvatarId, {
                id: currentAvatarId,
                name: currentAvatarName || known?.name || '',
                thumbnailUrl:
                    convertFileUrlToImageUrl(currentAvatarThumbnail, 128) ||
                    known?.thumbnailUrl ||
                    ''
            });
        }
        const nextGroups: AvatarOptionGroup[] = [
            {
                value: 'current',
                items: currentAvatarId ? [currentAvatarId] : []
            },
            {
                value: 'own',
                items: ownIds.filter((id) => id !== currentAvatarId)
            },
            {
                value: 'favorite',
                items: favoriteIds.filter((id) => id !== currentAvatarId)
            }
        ];
        return {
            groups: nextGroups.filter((group) => group.items.length > 0),
            optionsById: byId
        };
    }, [
        currentAvatarId,
        currentAvatarName,
        currentAvatarThumbnail,
        favoriteAvatarIds,
        favoriteAvatars.data,
        ownAvatars.data
    ]);

    const loading = ownAvatars.isFetching || favoriteAvatars.isFetching;
    const avatarLabel = (id: string) => optionsById.get(id)?.name ?? '';
    const groupLabels: Record<AvatarOptionGroup['value'], string> = {
        current: t('dialog.launch.avatar_switch.group.current'),
        own: t('dialog.launch.avatar_switch.group.own'),
        favorite: t('dialog.launch.avatar_switch.group.favorite')
    };
    const avatarName = (option: AvatarOption | undefined) =>
        option?.name ? (
            option.name
        ) : (
            <span className="text-muted-foreground">{groupLabels.current}</span>
        );

    return (
        <Combobox
            items={groups}
            value={value || null}
            disabled={disabled}
            itemToStringLabel={avatarLabel}
            onValueChange={(id: string | null) => {
                if (id) onValueChange(id);
            }}
        >
            <ComboboxTrigger
                aria-label={t('dialog.launch.avatar_switch.toggle')}
                render={
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full min-w-0 justify-between font-normal"
                    />
                }
            >
                <ComboboxValue>
                    {(id: string | null) => {
                        const option = id ? optionsById.get(id) : undefined;
                        return option ? (
                            <span className="flex min-w-0 items-center gap-2">
                                <AvatarThumbnail
                                    url={option.thumbnailUrl}
                                    className="size-5"
                                />
                                <span className="truncate">
                                    {avatarName(option)}
                                </span>
                            </span>
                        ) : (
                            <span className="text-muted-foreground truncate">
                                {t('dialog.launch.avatar_switch.placeholder')}
                            </span>
                        );
                    }}
                </ComboboxValue>
            </ComboboxTrigger>
            <ComboboxContent className="bg-popover!">
                <ComboboxInput
                    showTrigger={false}
                    placeholder={t(
                        'dialog.launch.avatar_switch.search_placeholder'
                    )}
                />
                <ComboboxEmpty>
                    {loading
                        ? t('common.loading')
                        : t('common.no_matching_records')}
                </ComboboxEmpty>
                <ComboboxList>
                    {(group: AvatarOptionGroup) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                            <ComboboxLabel>
                                {groupLabels[group.value]}
                            </ComboboxLabel>
                            <ComboboxCollection>
                                {(id: string) => {
                                    const option = optionsById.get(id);
                                    return (
                                        <ComboboxItem key={id} value={id}>
                                            <AvatarThumbnail
                                                url={option?.thumbnailUrl ?? ''}
                                                className="size-7"
                                            />
                                            <span className="min-w-0 flex-1 truncate">
                                                {avatarName(option)}
                                            </span>
                                        </ComboboxItem>
                                    );
                                }}
                            </ComboboxCollection>
                        </ComboboxGroup>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}

export function LaunchAvatarSwitch({
    open,
    value,
    disabled,
    onOpenChange,
    onValueChange
}: {
    open: boolean;
    value: string;
    disabled: boolean;
    onOpenChange(open: boolean): void;
    onValueChange(avatarId: string): void;
}) {
    const { t } = useTranslation();

    return (
        <Collapsible open={open} onOpenChange={onOpenChange} className="-mt-2">
            <CollapsibleTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="group text-muted-foreground aria-expanded:bg-transparent"
                    />
                }
            >
                <ChevronRightIcon
                    data-icon="inline-start"
                    className="transition-transform duration-150 ease-out group-data-[panel-open]:rotate-90"
                />
                {t('dialog.launch.avatar_switch.toggle')}
            </CollapsibleTrigger>
            <CollapsibleContent className="-mx-1 -mb-1 h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-150 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                <div className="flex items-center gap-2 p-1">
                    <div className="min-w-0 flex-1">
                        <LaunchAvatarPicker
                            value={value}
                            disabled={disabled}
                            onValueChange={onValueChange}
                        />
                    </div>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <span
                                    data-testid="launch-avatar-switch-hint"
                                    className="text-muted-foreground hover:text-foreground flex shrink-0 cursor-help items-center transition-colors"
                                />
                            }
                        >
                            <InfoIcon className="size-3.5" aria-hidden="true" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">
                            {t('dialog.launch.avatar_switch.hint')}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
