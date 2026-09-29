// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardRow } from '@/repositories/dashboardRepository';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

vi.mock('./DashboardViewParts', () => ({
    DashboardPanelPreviewForPanel: () => <div>preview</div>,
    DashboardPanelSelectorDialog: ({ open }: { open: boolean }) => (
        <div data-testid="panel-selector">{String(open)}</div>
    ),
    DashboardWidgetConfigEditor: ({ panelKey }: { panelKey: string }) => (
        <div data-testid="widget-config">{panelKey}</div>
    )
}));

import { DashboardEditorWorkspace } from './DashboardEditorWorkspace';

function renderWorkspace(rows: DashboardRow[]) {
    const props = {
        onAddRow: vi.fn(),
        onDirectionChange: vi.fn(),
        onPanelChange: vi.fn(),
        onPanelRemove: vi.fn(),
        onRowRemove: vi.fn()
    };

    render(
        <TooltipProvider>
            <DashboardEditorWorkspace rows={rows} {...props} />
        </TooltipProvider>
    );

    return props;
}

describe('DashboardEditorWorkspace', () => {
    afterEach(cleanup);

    it('turns a full-width row into a two-column row without changing persistence shape', () => {
        const props = renderWorkspace([
            { id: 'row-1', direction: 'horizontal', panels: ['feed'] }
        ]);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dashboard.actions.add_split_row'
            })
        );

        expect(props.onPanelChange).toHaveBeenCalledWith(0, 1, null);
        expect(props.onDirectionChange).toHaveBeenCalledWith(0, 'horizontal');
    });

    it('inserts a selected layout at the chosen row boundary and opens panel selection', () => {
        const props = renderWorkspace([
            { id: 'row-1', direction: 'horizontal', panels: ['feed'] }
        ]);

        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'view.dashboard.action.add_row'
            })[0]
        );
        fireEvent.click(
            screen.getAllByRole('button', {
                name: 'dashboard.actions.add_full_row'
            })[0]
        );

        expect(props.onAddRow).toHaveBeenCalledWith(1, 'horizontal', 0);
        expect(screen.getByTestId('panel-selector').textContent).toBe('true');
    });

    it('collapses a split row by removing only its second panel slot', () => {
        const props = renderWorkspace([
            {
                id: 'row-1',
                direction: 'vertical',
                panels: ['feed', 'game-log']
            }
        ]);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dashboard.actions.add_full_row'
            })
        );

        expect(props.onPanelRemove).toHaveBeenCalledWith(0, 1);
    });

    it('shows widget settings for the selected real preview and clears it explicitly', () => {
        const props = renderWorkspace([
            {
                id: 'row-1',
                direction: 'horizontal',
                panels: [{ key: 'widget:game-log', config: { filters: [] } }]
            }
        ]);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dashboard.registry.game_log_widget'
            })
        );

        expect(screen.getByTestId('widget-config').textContent).toBe(
            'widget:game-log'
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.clear' })
        );
        expect(props.onPanelChange).toHaveBeenCalledWith(0, 0, null);
    });
});
