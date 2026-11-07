import { icons, type LucideIcon } from 'lucide-react';

export const BADGE_ICONS: Readonly<Record<string, LucideIcon>> = icons;

export const BADGE_ICON_NAMES: readonly string[] = Object.keys(icons).sort();
