import { lazy, Suspense } from 'react';

import { isDevKitBuild } from '@/shared/buildLabel';

import { AppBootstrap } from './bootstrap/AppBootstrap';
import { AppProviders } from './providers/AppProviders';
import { AppRouter } from './router';

// Only DevKit builds show the panel, so other builds never load its code.
const DevKitPanel = lazy(() =>
    import('@/features/devkit/DevKitPanel').then((module) => ({
        default: module.DevKitPanel
    }))
);

export function App() {
    return (
        <AppProviders>
            <AppBootstrap />
            <AppRouter />
            {isDevKitBuild() ? (
                <Suspense fallback={null}>
                    <DevKitPanel />
                </Suspense>
            ) : null}
        </AppProviders>
    );
}
