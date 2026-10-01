import {
    DndContext,
    closestCenter,
    type DragEndEvent,
    useDroppable
} from '@dnd-kit/core';
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    EyeIcon,
    EyeOffIcon,
    GripVerticalIcon,
    ListPlusIcon,
    PencilIcon,
    Trash2Icon,
    UngroupIcon,
    type LucideIcon
} from 'lucide-react';
import type {
    CSSProperties,
    HTMLAttributes,
    MouseEvent,
    ReactNode
} from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import { cn } from '@/lib/utils';
import {
    DEFAULT_FOLDER_ICON,
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';
import { isToolNavKey } from '@/shared/constants/tools';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    definitionLabel,
    getFolderDropId,
    getFolderItemIcon,
    getFolderItemKey,
    getFolderSortableId,
    getItemSortableId,
    isDashboardKey,
    type CustomNavDefinition,
    type CustomNavLayout
} from './customNavLayout';
import { NavIconPicker } from './NavIconPicker';

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;
type DndSensors = Parameters<typeof DndContext>[0]['sensors'];
type DragHandleProps = HTMLAttributes<HTMLElement> & {
    ref?: (node: HTMLElement | null) => void;
};
type SortableRowRenderProps = {
    rowRef: (node: HTMLElement | null) => void;
    rowStyle: CSSProperties;
    dragHandleProps: DragHandleProps;
    isDragging: boolean;
};

type MoveCandidate = {
    key: string;
    label: string;
    icon?: string;
};

type SortableNavItemRowProps = {
    id: string;
    children: (props: SortableRowRenderProps) => ReactNode;
};

type NavDefinitionRowProps = {
    itemKey: string;
    definition: CustomNavDefinition;
    icon?: string;
    indent?: boolean;
    justMoved: boolean;
    onIconChange: (icon: string) => void;
    onHide: () => void;
    onEditDashboard: () => void;
    onDeleteDashboard: () => void;
};

type FolderHeaderRowProps = {
    folderId: string;
    name?: string;
    icon?: string;
    itemCount: number;
    candidates: MoveCandidate[];
    onIconChange: (icon: string) => void;
    onAddItem: (key: string) => void;
    onRename: () => void;
    onUngroup: () => void;
};

type FolderDropZoneProps = {
    folderId: string;
    label: ReactNode;
};

type HiddenNavItem = {
    key: string;
    label: string;
};

type CustomNavDialogLayoutEditorProps = {
    sensors: DndSensors;
    sortableNodeIds: string[];
    localLayout: CustomNavLayout;
    definitionMap: Map<string, CustomNavDefinition>;
    hiddenItems: HiddenNavItem[];
    justMovedKey: string;
    onDragEnd: (event: DragEndEvent) => void;
    onFolderIconChange: (
        index: number,
        icon: string,
        fallbackIcon?: string
    ) => void;
    onFolderEdit: (index: number) => void;
    onFolderUngroup: (index: number) => void;
    onFolderChildIconChange: (
        folderIndex: number,
        itemIndex: number,
        icon: string,
        fallbackIcon: string
    ) => void;
    onMoveItemToFolder: (key: string, folderId: string) => void;
    onHideItem: (key: string) => void;
    onEditDashboard: (key: string) => void;
    onDeleteDashboard: (key: string) => void;
    onShowItem: (key: string) => void;
};

const JUST_MOVED_CLASS =
    'animate-in fade-in-0 slide-in-from-top-1 duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:slide-in-from-top-0';

function customNavActionLabel(t: TranslationFn, key: string, value: string) {
    return t(`nav_menu.custom_nav.dynamic.${key}`, { value });
}

function IconAction({
    label,
    icon: Icon,
    destructive = false,
    onClick
}: {
    label: string;
    icon: LucideIcon;
    destructive?: boolean;
    onClick: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                            'shrink-0',
                            destructive && 'text-destructive'
                        )}
                        aria-label={label}
                        onClick={onClick}
                    >
                        <Icon data-icon="icon" />
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function DragHandleButton({
    label,
    dragHandleProps
}: {
    label: string;
    dragHandleProps: DragHandleProps;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground shrink-0 cursor-grab touch-none active:cursor-grabbing"
            aria-label={label}
            {...dragHandleProps}
        >
            <GripVerticalIcon data-icon="icon" />
        </Button>
    );
}

function ColumnShell({
    title,
    count,
    children
}: {
    title: string;
    count: number;
    children: ReactNode;
}) {
    return (
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <div className="flex items-baseline gap-2 px-1">
                <span className="text-xs font-medium tracking-wide uppercase">
                    {title}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                    {count}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {children}
            </div>
        </div>
    );
}

function SortableNavItemRow({ id, children }: SortableNavItemRowProps) {
    const {
        attributes,
        listeners,
        setActivatorNodeRef,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });
    const rowStyle: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition
    };
    const dragHandleProps: DragHandleProps = {
        ...attributes,
        ...listeners,
        ref: setActivatorNodeRef,
        onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation()
    };

    return children({
        rowRef: setNodeRef,
        rowStyle,
        dragHandleProps,
        isDragging
    });
}

function NavDefinitionRow({
    itemKey,
    definition,
    icon,
    indent = false,
    justMoved,
    onIconChange,
    onHide,
    onEditDashboard,
    onDeleteDashboard
}: NavDefinitionRowProps) {
    const { t } = useTranslation();
    const label = definitionLabel(definition, t);

    return (
        <SortableNavItemRow id={getItemSortableId(itemKey)}>
            {({ rowRef, rowStyle, dragHandleProps, isDragging }) => (
                <div
                    ref={rowRef}
                    style={rowStyle}
                    className={cn(
                        'flex items-center gap-1 rounded-md border px-1 py-1 text-sm transition-colors',
                        isDragging && 'opacity-50',
                        indent && 'ml-6',
                        justMoved && JUST_MOVED_CLASS
                    )}
                >
                    <DragHandleButton
                        label={customNavActionLabel(t, 'drag_value', label)}
                        dragHandleProps={dragHandleProps}
                    />
                    <NavIconPicker
                        value={icon}
                        fallbackIcon={definition.icon || DEFAULT_NAV_ICON_KEY}
                        ariaLabel={customNavActionLabel(
                            t,
                            'icon_for_value',
                            label
                        )}
                        onValueChange={onIconChange}
                    />
                    <span className="min-w-0 flex-1 truncate px-1">
                        {label}
                    </span>
                    {isDashboardKey(itemKey) ? (
                        <>
                            <IconAction
                                label={customNavActionLabel(
                                    t,
                                    'edit_value',
                                    label
                                )}
                                icon={PencilIcon}
                                onClick={onEditDashboard}
                            />
                            <IconAction
                                label={customNavActionLabel(
                                    t,
                                    'delete_value',
                                    label
                                )}
                                icon={Trash2Icon}
                                destructive
                                onClick={onDeleteDashboard}
                            />
                        </>
                    ) : null}
                    {isToolNavKey(itemKey) ? (
                        <IconAction
                            label={t('nav_menu.custom_nav.unpin_from_nav')}
                            icon={Trash2Icon}
                            destructive
                            onClick={onHide}
                        />
                    ) : (
                        <IconAction
                            label={customNavActionLabel(t, 'hide_value', label)}
                            icon={EyeOffIcon}
                            onClick={onHide}
                        />
                    )}
                </div>
            )}
        </SortableNavItemRow>
    );
}

function FolderDropZone({ folderId, label }: FolderDropZoneProps) {
    const { setNodeRef } = useDroppable({
        id: getFolderDropId(folderId)
    });

    return (
        <div
            ref={setNodeRef}
            className="text-muted-foreground ml-6 rounded-md border border-dashed px-2 py-1.5 text-xs"
        >
            {label}
        </div>
    );
}

function FolderAddItemsButton({
    candidates,
    onAdd
}: {
    candidates: MoveCandidate[];
    onAdd: (key: string) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const label = t('nav_menu.custom_nav.move_into_folder');

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <span className="inline-flex shrink-0">
                            <PopoverTrigger
                                render={
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        disabled={!candidates.length}
                                        aria-label={label}
                                    >
                                        <ListPlusIcon data-icon="icon" />
                                    </Button>
                                }
                            />
                        </span>
                    }
                />
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <PopoverContent
                align="end"
                className="max-h-72 gap-1 overflow-y-auto p-1"
            >
                {candidates.map((candidate) => {
                    const CandidateIcon = getNavIconComponent(
                        normalizeNavIconKey(
                            candidate.icon,
                            DEFAULT_NAV_ICON_KEY
                        )
                    );
                    return (
                        <Button
                            key={candidate.key}
                            type="button"
                            variant="ghost"
                            className="h-auto w-full justify-start px-2 py-1.5 font-normal"
                            onClick={() => {
                                onAdd(candidate.key);
                                setOpen(false);
                            }}
                        >
                            <CandidateIcon data-icon="inline-start" />
                            <span className="min-w-0 flex-1 truncate text-left">
                                {candidate.label}
                            </span>
                        </Button>
                    );
                })}
            </PopoverContent>
        </Popover>
    );
}

function FolderHeaderRow({
    folderId,
    name,
    icon,
    itemCount,
    candidates,
    onIconChange,
    onAddItem,
    onRename,
    onUngroup
}: FolderHeaderRowProps) {
    const { t } = useTranslation();
    const folderName = name || '';

    return (
        <SortableNavItemRow id={getFolderSortableId(folderId)}>
            {({ rowRef, rowStyle, dragHandleProps, isDragging }) => (
                <div
                    ref={rowRef}
                    style={rowStyle}
                    className={cn(
                        'bg-muted/40 flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium transition-colors',
                        isDragging && 'opacity-50'
                    )}
                >
                    <DragHandleButton
                        label={customNavActionLabel(
                            t,
                            'drag_value',
                            folderName
                        )}
                        dragHandleProps={dragHandleProps}
                    />
                    <NavIconPicker
                        value={icon}
                        fallbackIcon={DEFAULT_FOLDER_ICON}
                        ariaLabel={customNavActionLabel(
                            t,
                            'icon_for_value',
                            folderName
                        )}
                        onValueChange={onIconChange}
                    />
                    <span className="min-w-0 flex-1 truncate px-1">
                        {folderName}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {t('nav_menu.custom_nav.folder_item_count', {
                            count: itemCount
                        })}
                    </span>
                    <FolderAddItemsButton
                        candidates={candidates}
                        onAdd={onAddItem}
                    />
                    <IconAction
                        label={customNavActionLabel(
                            t,
                            'rename_value',
                            folderName
                        )}
                        icon={PencilIcon}
                        onClick={onRename}
                    />
                    <IconAction
                        label={t('nav_menu.custom_nav.ungroup_folder')}
                        icon={UngroupIcon}
                        onClick={onUngroup}
                    />
                </div>
            )}
        </SortableNavItemRow>
    );
}

export function CustomNavDialogLayoutEditor({
    sensors,
    sortableNodeIds,
    localLayout,
    definitionMap,
    hiddenItems,
    justMovedKey,
    onDragEnd,
    onFolderIconChange,
    onFolderEdit,
    onFolderUngroup,
    onFolderChildIconChange,
    onMoveItemToFolder,
    onHideItem,
    onEditDashboard,
    onDeleteDashboard,
    onShowItem
}: CustomNavDialogLayoutEditorProps) {
    const { t } = useTranslation();
    const topLevelCandidates: MoveCandidate[] = localLayout.flatMap((entry) => {
        if (entry.type !== 'item') {
            return [];
        }
        const key = entry.key;
        const definition = definitionMap.get(key);
        if (!definition) {
            return [];
        }
        return [
            {
                key,
                label: definitionLabel(definition, t),
                icon: entry.icon || definition.icon
            }
        ];
    });
    const visibleCount = localLayout.reduce(
        (total, entry) =>
            total + (entry.type === 'folder' ? entry.items.length : 1),
        0
    );

    return (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden sm:grid-cols-[minmax(0,1fr)_15rem]">
            <ColumnShell
                title={t('nav_menu.custom_nav.visible_items')}
                count={visibleCount}
            >
                <DndContext
                    accessibility={
                        typeof document === 'undefined'
                            ? undefined
                            : { container: document.body }
                    }
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                >
                    <SortableContext
                        items={sortableNodeIds}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="flex flex-col gap-1">
                            {localLayout.map((entry, index) => {
                                if (entry.type === 'folder') {
                                    const folderId = entry.id;
                                    return (
                                        <div
                                            key={entry.id}
                                            className="flex flex-col gap-1 rounded-lg border p-2"
                                        >
                                            <FolderHeaderRow
                                                folderId={folderId}
                                                name={entry.name}
                                                icon={entry.icon}
                                                itemCount={entry.items.length}
                                                candidates={topLevelCandidates}
                                                onIconChange={(icon) =>
                                                    onFolderIconChange(
                                                        index,
                                                        icon
                                                    )
                                                }
                                                onAddItem={(key) =>
                                                    onMoveItemToFolder(
                                                        key,
                                                        folderId
                                                    )
                                                }
                                                onRename={() =>
                                                    onFolderEdit(index)
                                                }
                                                onUngroup={() =>
                                                    onFolderUngroup(index)
                                                }
                                            />
                                            {entry.items.length ? (
                                                <div className="flex flex-col gap-1">
                                                    {entry.items.map(
                                                        (item, childIndex) => {
                                                            const key =
                                                                getFolderItemKey(
                                                                    item
                                                                );
                                                            const definition =
                                                                definitionMap.get(
                                                                    key
                                                                );
                                                            if (!definition) {
                                                                return null;
                                                            }
                                                            return (
                                                                <NavDefinitionRow
                                                                    key={key}
                                                                    itemKey={
                                                                        key
                                                                    }
                                                                    definition={
                                                                        definition
                                                                    }
                                                                    icon={
                                                                        getFolderItemIcon(
                                                                            item
                                                                        ) ||
                                                                        definition.icon
                                                                    }
                                                                    indent
                                                                    justMoved={
                                                                        justMovedKey ===
                                                                        key
                                                                    }
                                                                    onIconChange={(
                                                                        icon
                                                                    ) =>
                                                                        onFolderChildIconChange(
                                                                            index,
                                                                            childIndex,
                                                                            icon,
                                                                            definition.icon ||
                                                                                DEFAULT_NAV_ICON_KEY
                                                                        )
                                                                    }
                                                                    onHide={() =>
                                                                        onHideItem(
                                                                            key
                                                                        )
                                                                    }
                                                                    onEditDashboard={() =>
                                                                        onEditDashboard(
                                                                            key
                                                                        )
                                                                    }
                                                                    onDeleteDashboard={() =>
                                                                        onDeleteDashboard(
                                                                            key
                                                                        )
                                                                    }
                                                                />
                                                            );
                                                        }
                                                    )}
                                                </div>
                                            ) : (
                                                <FolderDropZone
                                                    folderId={folderId}
                                                    label={t(
                                                        'nav_menu.custom_nav.folder_drop_here'
                                                    )}
                                                />
                                            )}
                                        </div>
                                    );
                                }

                                const key = entry.key;
                                const definition = definitionMap.get(key);
                                if (!definition) {
                                    return null;
                                }
                                return (
                                    <NavDefinitionRow
                                        key={key}
                                        itemKey={key}
                                        definition={definition}
                                        icon={entry.icon || definition.icon}
                                        justMoved={justMovedKey === key}
                                        onIconChange={(icon) =>
                                            onFolderIconChange(
                                                index,
                                                icon,
                                                definition.icon ||
                                                    DEFAULT_NAV_ICON_KEY
                                            )
                                        }
                                        onHide={() => onHideItem(key)}
                                        onEditDashboard={() =>
                                            onEditDashboard(key)
                                        }
                                        onDeleteDashboard={() =>
                                            onDeleteDashboard(key)
                                        }
                                    />
                                );
                            })}
                        </div>
                    </SortableContext>
                </DndContext>
            </ColumnShell>
            <ColumnShell
                title={t('nav_menu.custom_nav.hidden_items')}
                count={hiddenItems.length}
            >
                {hiddenItems.length ? (
                    <div className="flex flex-col gap-1">
                        {hiddenItems.map((item) => (
                            <Button
                                key={item.key}
                                type="button"
                                variant="ghost"
                                className={cn(
                                    'text-muted-foreground h-auto w-full justify-start px-2 py-1.5 text-left font-normal',
                                    justMovedKey === item.key &&
                                        JUST_MOVED_CLASS
                                )}
                                aria-label={customNavActionLabel(
                                    t,
                                    'show_value',
                                    item.label
                                )}
                                onClick={() => onShowItem(item.key)}
                            >
                                <EyeIcon data-icon="inline-start" />
                                <span className="min-w-0 flex-1 truncate">
                                    {item.label}
                                </span>
                            </Button>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground rounded-md border border-dashed px-2 py-3 text-center text-xs">
                        {t('nav_menu.custom_nav.hidden_empty')}
                    </p>
                )}
            </ColumnShell>
        </div>
    );
}
