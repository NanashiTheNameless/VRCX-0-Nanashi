// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Dashboard } from '@/repositories/dashboardRepository';

import { useDashboardEditorState } from './useDashboardEditorState';

const dashboard: Dashboard = {
    id: 'dashboard-1',
    name: 'Dashboard',
    icon: 'layout-dashboard',
    rows: [
        { id: 'row-1', direction: 'horizontal', panels: ['feed'] },
        { id: 'row-2', direction: 'horizontal', panels: ['game-log'] }
    ]
};

function renderEditor(saveDashboard = vi.fn()) {
    return {
        saveDashboard,
        ...renderHook(() =>
            useDashboardEditorState({
                consumeEditingDashboardId: () => false,
                dashboard,
                editingDashboardId: null,
                loaded: true,
                saveDashboard
            })
        )
    };
}

describe('useDashboardEditorState', () => {
    it('inserts new layouts at the requested canvas position and marks the draft dirty', () => {
        const { result } = renderEditor();

        act(() => result.current.handleAddRow(2, 'vertical', 1));

        expect(result.current.editRows).toHaveLength(3);
        expect(result.current.editRows[0].id).toBe('row-1');
        expect(result.current.editRows[1]).toMatchObject({
            direction: 'vertical',
            panels: [null, null]
        });
        expect(result.current.editRows[2].id).toBe('row-2');
        expect(result.current.isDirty).toBe(true);
    });

    it('does not persist an unchanged draft', async () => {
        const saveDashboard = vi.fn();
        const { result } = renderEditor(saveDashboard);

        await act(async () => {
            await result.current.handleSave();
        });

        expect(result.current.isDirty).toBe(false);
        expect(saveDashboard).not.toHaveBeenCalled();
    });
});
