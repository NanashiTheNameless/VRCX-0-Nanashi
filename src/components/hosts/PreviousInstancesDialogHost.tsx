import { lazy, Suspense } from 'react';

import { usePreviousInstancesDialogStore } from '@/state/previousInstancesDialogStore';

// Tables, drag-and-drop and chart code load only when the dialog first opens.
const PreviousInstancesTableDialog = lazy(() =>
    import('@/components/dialogs/PreviousInstancesTableDialog').then(
        (module) => ({ default: module.PreviousInstancesTableDialog })
    )
);

export function PreviousInstancesDialogHost() {
    const dialog = usePreviousInstancesDialogStore((state) => state.dialog);
    const setRows = usePreviousInstancesDialogStore(
        (state) => state.setPreviousInstancesDialogRows
    );
    const setOpen = usePreviousInstancesDialogStore(
        (state) => state.setPreviousInstancesDialogOpen
    );

    if (!dialog.open) {
        return null;
    }

    return (
        <Suspense fallback={null}>
            <PreviousInstancesTableDialog
                open={dialog.open}
                onOpenChange={setOpen}
                title={dialog.title}
                instances={dialog.rows}
                variant="world"
                onRowsChange={setRows}
                detailsOnly={dialog.detailsOnly}
            />
        </Suspense>
    );
}
