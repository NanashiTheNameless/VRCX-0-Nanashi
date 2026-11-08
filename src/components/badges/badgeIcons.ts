import type { LucideIcon } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

type BadgeIconCatalog = {
    icons: Readonly<Record<string, LucideIcon>>;
    names: readonly string[];
};

let catalog: BadgeIconCatalog | null = null;
let pending: Promise<BadgeIconCatalog> | null = null;
const listeners = new Set<() => void>();

// The full icon set is large, so it only loads once a custom badge or the
// badge editor is shown, as two chunks (Lucide and Lucide Lab) fetched side
// by side so neither is oversized.
export function loadBadgeIcons(): Promise<BadgeIconCatalog> {
    if (catalog) {
        return Promise.resolve(catalog);
    }
    pending ??= Promise.all([
        import('./badgeIconCatalogLucide'),
        import('./badgeIconCatalogLab')
    ]).then(([lucide, lab]) => {
        const icons: Readonly<Record<string, LucideIcon>> = {
            ...lucide.LUCIDE_ICONS,
            ...lab.labIcons((name) => name in lucide.LUCIDE_ICONS)
        };
        catalog = { icons, names: Object.keys(icons).sort() };
        for (const listener of listeners) {
            listener();
        }
        return catalog;
    });
    pending.catch(() => {
        pending = null;
    });
    return pending;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function getSnapshot() {
    return catalog;
}

export function useBadgeIconCatalog(enabled = true): BadgeIconCatalog | null {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    useEffect(() => {
        if (enabled && !current) {
            loadBadgeIcons().catch((error: unknown) => {
                console.warn('Failed to load badge icons.', error);
            });
        }
    }, [current, enabled]);
    return current;
}

export function badgeIconLabel(name: string): string {
    // Lucide Lab icons are stored as "Lab" plus their name (see
    // badgeIconCatalogLab); no Lucide icon name starts that way.
    const lab = /^Lab(?=[A-Z])/.test(name);
    const label = (lab ? name.slice(3) : name).replace(
        /([a-z0-9])([A-Z])/g,
        '$1 $2'
    );
    return lab ? `${label} (Lab)` : label;
}
