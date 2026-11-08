import * as lab from '@lucide/lab';
import { createLucideIcon, type IconNode, type LucideIcon } from 'lucide-react';

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

/**
 * Lucide Lab icons, minus the ones Lucide has since adopted: those already
 * appear under their Lucide name.
 */
export function labIcons(
    isLucideIcon: (name: string) => boolean
): Record<string, LucideIcon> {
    const found: Record<string, LucideIcon> = {};
    for (const [key, node] of Object.entries(lab)) {
        // The package also exposes its module object ("default",
        // "module.exports"); only icon drawings are arrays of elements.
        if (!isIconNode(node)) {
            continue;
        }
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        if (isLucideIcon(name)) {
            continue;
        }
        const id = `${LAB_ICON_PREFIX}${name}`;
        found[id] = createLucideIcon(id, node);
    }
    return found;
}
