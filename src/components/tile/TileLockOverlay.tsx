import { LockIcon } from 'lucide-react';

import {
    TILE_LOCK_ICON,
    TILE_LOCK_OVERLAY
} from '@/shared/constants/selectableTile';

export function TileLockOverlay() {
    return (
        <span className={TILE_LOCK_OVERLAY}>
            <span className={TILE_LOCK_ICON}>
                <LockIcon className="size-4" />
            </span>
        </span>
    );
}
