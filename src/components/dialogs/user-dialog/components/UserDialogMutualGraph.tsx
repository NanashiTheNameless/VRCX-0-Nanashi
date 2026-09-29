import { lazy, Suspense } from 'react';

import { Spinner } from '@/ui/shadcn/spinner';

import type { UserDialogMutualGraphProps } from './UserDialogMutualGraphImpl';

const UserDialogMutualGraphImpl = lazy(() =>
    import('./UserDialogMutualGraphImpl').then((module) => ({
        default: module.UserDialogMutualGraph
    }))
);

export function UserDialogMutualGraph(props: UserDialogMutualGraphProps) {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner className="text-muted-foreground size-4" />
                </div>
            }
        >
            <UserDialogMutualGraphImpl {...props} />
        </Suspense>
    );
}
