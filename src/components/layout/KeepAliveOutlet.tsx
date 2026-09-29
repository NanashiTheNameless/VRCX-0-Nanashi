import { Activity, useMemo, useState, type ReactNode } from 'react';
import {
    NavigationType,
    UNSAFE_LocationContext as LocationContext,
    useLocation,
    useNavigationType,
    useOutlet,
    type Location
} from 'react-router';

/** How many recently visited pages stay mounted (hidden) for instant return. */
export const KEEP_ALIVE_PAGE_LIMIT = 5;

type CachedPage = {
    key: string;
    element: ReactNode;
    location: Location;
};

/**
 * Fork: an `<Outlet />` that keeps the last few pages mounted but hidden, so
 * switching back is instant and keeps each page's state and scroll position.
 * Hidden pages run no effects (React `Activity`), and each one keeps seeing
 * the location it was left at, so it never reacts to another page's URL.
 */
export function KeepAliveOutlet({
    limit = KEEP_ALIVE_PAGE_LIMIT
}: {
    limit?: number;
}) {
    const location = useLocation();
    const outlet = useOutlet();
    const navigationType = useNavigationType();
    const key = location.pathname;
    const [pages, setPages] = useState<CachedPage[]>([]);

    // Keyed by pathname: route elements change identity every render, so the
    // cache only updates when the page or its location changes.
    const current = pages[0];
    if (!current || current.key !== key || current.location !== location) {
        setPages((previous) =>
            [
                {
                    key,
                    element:
                        previous.find((page) => page.key === key)?.element ??
                        outlet,
                    location
                },
                ...previous.filter((page) => page.key !== key)
            ].slice(0, Math.max(1, limit))
        );
    }

    return pages.map((page) => {
        const active = page.key === key;
        return (
            <Activity key={page.key} mode={active ? 'visible' : 'hidden'}>
                <PageLocation
                    location={active ? location : page.location}
                    navigationType={
                        active ? navigationType : NavigationType.Pop
                    }
                >
                    {active ? outlet : page.element}
                </PageLocation>
            </Activity>
        );
    });
}

function PageLocation({
    location,
    navigationType,
    children
}: {
    location: Location;
    navigationType: NavigationType;
    children: ReactNode;
}) {
    const value = useMemo(
        () => ({ location, navigationType }),
        [location, navigationType]
    );
    return (
        <LocationContext.Provider value={value}>
            {children}
        </LocationContext.Provider>
    );
}
