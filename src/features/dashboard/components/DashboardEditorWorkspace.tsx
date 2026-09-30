import { Settings2Icon, Trash2Icon } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type {
    DashboardDirection,
    DashboardPanel,
    DashboardRow
} from '@/repositories/dashboardRepository';
import { Button } from '@/ui/shadcn/button';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    createDashboardWidgetPanelValue,
    type DashboardConfig,
    getDashboardPanelConfig,
    getDashboardRowKey
} from '../dashboardConfig';
import {
    createDashboardPanelValue,
    getDashboardPanelDefinition,
    getDashboardPanelDescription,
    getDashboardPanelLabel,
    resolveDashboardPanelKey
} from '../dashboardRegistry';
import { DashboardAddRowControl } from './DashboardAddRowControl';
import {
    DashboardPanelPreviewForPanel,
    DashboardPanelSelectorDialog,
    DashboardWidgetConfigEditor
} from './DashboardViewParts';

type DashboardPanelAddress = {
    rowIndex: number;
    panelIndex: number;
};

type DashboardEditorWorkspaceProps = {
    rows: DashboardRow[];
    onAddRow: (
        panelCount: number,
        direction: DashboardDirection,
        insertIndex: number
    ) => void;
    onDirectionChange: (
        rowIndex: number,
        direction: DashboardDirection
    ) => void;
    onPanelChange: (
        rowIndex: number,
        panelIndex: number,
        panel: DashboardPanel | null
    ) => void;
    onPanelRemove: (rowIndex: number, panelIndex: number) => void;
    onRowRemove: (rowIndex: number) => void;
};

function LayoutPreview({
    direction
}: {
    direction: 'single' | DashboardDirection;
}) {
    if (direction === 'single') {
        return <span className="h-3.5 w-6 rounded-[3px] bg-current/25" />;
    }

    return (
        <span
            className={cn(
                'flex h-3.5 w-6 gap-0.5',
                direction === 'vertical' && 'flex-col'
            )}
        >
            <span className="min-h-0 min-w-0 flex-1 rounded-[2px] bg-current/25" />
            <span className="min-h-0 min-w-0 flex-1 rounded-[2px] bg-current/25" />
        </span>
    );
}

function LayoutButton({
    direction,
    label
}: {
    direction: 'single' | DashboardDirection;
    label: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <ToggleGroupItem aria-label={label} value={direction}>
                        <LayoutPreview direction={direction} />
                    </ToggleGroupItem>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function DashboardEditorCanvasPanel({
    panel,
    selected,
    onSelect
}: {
    panel: DashboardPanel | null;
    selected: boolean;
    onSelect: () => void;
}) {
    const { t } = useTranslation();
    const panelKey = resolveDashboardPanelKey(panel);
    const definition = getDashboardPanelDefinition(panelKey);
    const label = definition
        ? getDashboardPanelLabel(definition, t)
        : panelKey || t('view.dashboard.label.not_configured');

    return (
        <div
            className={cn(
                'bg-card relative h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
                selected && 'border-primary ring-primary/20 ring-2'
            )}
        >
            <div className="pointer-events-none size-full min-h-0" inert>
                <DashboardPanelPreviewForPanel panel={panel} />
            </div>
            <button
                type="button"
                className="focus-visible:ring-ring/50 absolute inset-0 z-10 cursor-pointer rounded-lg outline-none hover:bg-(--state-hover-surface) focus-visible:ring-[3px] focus-visible:ring-inset"
                aria-label={label}
                aria-pressed={selected}
                onClick={onSelect}
            />
        </div>
    );
}

function DashboardEditorRow({
    row,
    rowIndex,
    selectedPanel,
    onDirectionChange,
    onPanelChange,
    onPanelRemove,
    onPanelSelect,
    onRowRemove
}: {
    row: DashboardRow;
    rowIndex: number;
    selectedPanel: DashboardPanelAddress | null;
    onDirectionChange: (direction: DashboardDirection) => void;
    onPanelChange: (panelIndex: number, panel: DashboardPanel | null) => void;
    onPanelRemove: (panelIndex: number) => void;
    onPanelSelect: (panelIndex: number, panel: DashboardPanel | null) => void;
    onRowRemove: () => void;
}) {
    const { t } = useTranslation();
    const panels = row.panels.slice(0, 2);
    const direction = row.direction === 'vertical' ? 'vertical' : 'horizontal';
    const layout = panels.length === 1 ? 'single' : direction;

    function setLayout(nextLayout: 'single' | DashboardDirection) {
        if (nextLayout === 'single') {
            if (panels.length === 2) {
                onPanelRemove(1);
            }
            return;
        }

        if (panels.length === 1) {
            onPanelChange(1, null);
        }
        onDirectionChange(nextLayout);
    }

    return (
        <section className="bg-muted/5 flex flex-col gap-2 rounded-lg border p-2">
            <div className="flex min-h-8 items-center justify-between gap-3 px-1">
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {t('view.dashboard.label.row')} {rowIndex + 1}
                </div>
                <div className="flex items-center gap-1">
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={[layout]}
                        onValueChange={(values) => {
                            const next = values[0];
                            if (
                                next === 'single' ||
                                next === 'horizontal' ||
                                next === 'vertical'
                            )
                                setLayout(next);
                        }}
                    >
                        <LayoutButton
                            direction="single"
                            label={t('dashboard.actions.add_full_row')}
                        />
                        <ToggleGroupSeparator />
                        <LayoutButton
                            direction="horizontal"
                            label={t('dashboard.actions.add_split_row')}
                        />
                        <ToggleGroupSeparator />
                        <LayoutButton
                            direction="vertical"
                            label={t('dashboard.actions.add_vertical_row')}
                        />
                    </ToggleGroup>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    aria-label={`${t('common.actions.delete')} ${t('view.dashboard.label.row')} ${rowIndex + 1}`}
                                    onClick={onRowRemove}
                                >
                                    <Trash2Icon data-icon="icon" />
                                </Button>
                            }
                        />
                        <TooltipContent>
                            {t('common.actions.delete')}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
            <div
                className={cn(
                    'flex h-[28rem] min-h-0 gap-2',
                    direction === 'vertical' && panels.length === 2
                        ? 'flex-col'
                        : 'flex-row'
                )}
            >
                {panels.map((panel, panelIndex) => (
                    <DashboardEditorCanvasPanel
                        key={`${getDashboardRowKey(row)}-${panelIndex}`}
                        panel={panel}
                        selected={
                            selectedPanel?.rowIndex === rowIndex &&
                            selectedPanel.panelIndex === panelIndex
                        }
                        onSelect={() => onPanelSelect(panelIndex, panel)}
                    />
                ))}
            </div>
        </section>
    );
}

export function DashboardEditorWorkspace({
    rows,
    onAddRow,
    onDirectionChange,
    onPanelChange,
    onPanelRemove,
    onRowRemove
}: DashboardEditorWorkspaceProps) {
    const { t } = useTranslation();
    const [selectedPanel, setSelectedPanel] =
        useState<DashboardPanelAddress | null>(null);
    const [selectorTarget, setSelectorTarget] =
        useState<DashboardPanelAddress | null>(null);

    const selectedRow = selectedPanel ? rows[selectedPanel.rowIndex] : null;
    const selectedPanelExists = Boolean(
        selectedRow &&
        selectedPanel &&
        selectedPanel.panelIndex < selectedRow.panels.length
    );
    const selectedPanelValue =
        selectedPanelExists && selectedPanel
            ? selectedRow?.panels[selectedPanel.panelIndex] || null
            : null;
    const selectedPanelKey = resolveDashboardPanelKey(selectedPanelValue);
    const selectedDefinition = getDashboardPanelDefinition(selectedPanelKey);
    const selectedConfig = getDashboardPanelConfig(selectedPanelValue);

    function selectPanel(
        rowIndex: number,
        panelIndex: number,
        panel: DashboardPanel | null
    ) {
        const address = { rowIndex, panelIndex };
        setSelectedPanel(address);
        if (!panel) {
            setSelectorTarget(address);
        }
    }

    function updateSelectedConfig(nextConfig: DashboardConfig) {
        if (
            !selectedPanel ||
            !selectedPanelExists ||
            selectedDefinition?.category !== 'widget'
        ) {
            return;
        }

        onPanelChange(
            selectedPanel.rowIndex,
            selectedPanel.panelIndex,
            createDashboardWidgetPanelValue(selectedDefinition.key, nextConfig)
        );
    }

    const selectorPanel = selectorTarget
        ? rows[selectorTarget.rowIndex]?.panels[selectorTarget.panelIndex]
        : null;
    const selectorPanelKey =
        resolveDashboardPanelKey(selectorPanel) ?? '__none__';

    return (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
            <div className="min-h-0 pr-1 lg:overflow-y-auto">
                <div className="mx-auto flex w-full max-w-[96rem] flex-col pb-3">
                    <DashboardAddRowControl
                        onAddRow={(panelCount, direction) => {
                            const address = { rowIndex: 0, panelIndex: 0 };
                            onAddRow(panelCount, direction, 0);
                            setSelectedPanel(address);
                            setSelectorTarget(address);
                        }}
                    />
                    {rows.map((row, rowIndex) => (
                        <Fragment
                            key={`${getDashboardRowKey(row)}-${rowIndex}`}
                        >
                            <DashboardEditorRow
                                row={row}
                                rowIndex={rowIndex}
                                selectedPanel={selectedPanel}
                                onDirectionChange={(direction) =>
                                    onDirectionChange(rowIndex, direction)
                                }
                                onPanelChange={(panelIndex, panel) =>
                                    onPanelChange(rowIndex, panelIndex, panel)
                                }
                                onPanelRemove={(panelIndex) => {
                                    onPanelRemove(rowIndex, panelIndex);
                                    if (
                                        selectedPanel?.rowIndex === rowIndex &&
                                        selectedPanel.panelIndex === panelIndex
                                    ) {
                                        setSelectedPanel({
                                            rowIndex,
                                            panelIndex: 0
                                        });
                                    }
                                }}
                                onPanelSelect={(panelIndex, panel) =>
                                    selectPanel(rowIndex, panelIndex, panel)
                                }
                                onRowRemove={() => {
                                    onRowRemove(rowIndex);
                                    setSelectedPanel(null);
                                }}
                            />
                            <DashboardAddRowControl
                                onAddRow={(panelCount, direction) => {
                                    const insertIndex = rowIndex + 1;
                                    const address = {
                                        rowIndex: insertIndex,
                                        panelIndex: 0
                                    };
                                    onAddRow(
                                        panelCount,
                                        direction,
                                        insertIndex
                                    );
                                    setSelectedPanel(address);
                                    setSelectorTarget(address);
                                }}
                            />
                        </Fragment>
                    ))}
                </div>
            </div>
            <aside className="bg-card min-h-0 rounded-lg border p-4 lg:overflow-y-auto">
                <div className="mb-4 flex items-center gap-2">
                    <Settings2Icon className="text-muted-foreground size-4" />
                    <h2 className="text-sm font-semibold">
                        {t('common.settings')}
                    </h2>
                </div>
                {selectedPanelExists && selectedPanel ? (
                    <div className="flex flex-col gap-4">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                                {selectedDefinition
                                    ? getDashboardPanelLabel(
                                          selectedDefinition,
                                          t
                                      )
                                    : t('view.dashboard.label.not_configured')}
                            </div>
                            {selectedDefinition ? (
                                <div className="text-muted-foreground mt-1 text-xs">
                                    {getDashboardPanelDescription(
                                        selectedDefinition,
                                        t
                                    )}
                                </div>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectorTarget(selectedPanel)}
                            >
                                {t('view.dashboard.action.select_panel')}
                            </Button>
                            {selectedPanelKey ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() =>
                                        onPanelChange(
                                            selectedPanel.rowIndex,
                                            selectedPanel.panelIndex,
                                            null
                                        )
                                    }
                                >
                                    {t('common.actions.clear')}
                                </Button>
                            ) : null}
                        </div>
                        {selectedDefinition?.category === 'widget' &&
                        selectedPanelKey ? (
                            <DashboardWidgetConfigEditor
                                panelKey={selectedPanelKey}
                                config={selectedConfig}
                                onConfigChange={updateSelectedConfig}
                            />
                        ) : null}
                    </div>
                ) : (
                    <div className="text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm">
                        <Settings2Icon className="size-5 opacity-50" />
                        <span>
                            {t('view.dashboard.success.panel_not_selected')}
                        </span>
                    </div>
                )}
            </aside>
            <DashboardPanelSelectorDialog
                open={Boolean(selectorTarget)}
                currentPanelKey={selectorPanelKey}
                onOpenChange={(open) => {
                    if (!open) {
                        setSelectorTarget(null);
                    }
                }}
                onSelect={(value) => {
                    if (selectorTarget) {
                        onPanelChange(
                            selectorTarget.rowIndex,
                            selectorTarget.panelIndex,
                            createDashboardPanelValue(value)
                        );
                        setSelectedPanel(selectorTarget);
                    }
                    setSelectorTarget(null);
                }}
            />
        </div>
    );
}
