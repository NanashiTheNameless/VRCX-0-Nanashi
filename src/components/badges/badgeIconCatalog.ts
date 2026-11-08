import * as lab from '@lucide/lab';
import {
    createLucideIcon,
    icons,
    type IconNode,
    type LucideIcon
} from 'lucide-react';

// Lucide Lab icons are stored with this prefix so a saved badge never
// switches icon if Lucide later adds one with the same name.
export const LAB_ICON_PREFIX = 'Lab';

function isIconNode(value: unknown): value is IconNode {
    return (
        Array.isArray(value) &&
        value.every(
            (element) =>
                Array.isArray(element) && typeof element[0] === 'string'
        )
    );
}

function labIcons(): Record<string, LucideIcon> {
    const found: Record<string, LucideIcon> = {};
    for (const [key, node] of Object.entries(lab)) {
        // The package also exposes its module object ("default",
        // "module.exports"); only icon drawings are arrays of elements.
        if (!isIconNode(node)) {
            continue;
        }
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        // Lab icons that Lucide has since adopted already appear under
        // their Lucide name.
        if (name in icons) {
            continue;
        }
        const id = `${LAB_ICON_PREFIX}${name}`;
        found[id] = createLucideIcon(id, node);
    }
    return found;
}

export const BADGE_ICONS: Readonly<Record<string, LucideIcon>> = {
    ...icons,
    ...labIcons()
};

export const BADGE_ICON_NAMES: readonly string[] =
    Object.keys(BADGE_ICONS).sort();
