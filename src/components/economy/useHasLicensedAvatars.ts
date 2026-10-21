import { useEffect, useState } from 'react';

import vrchatEconomyRepository from '@/repositories/vrchatEconomyRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

export function useHasLicensedAvatars(enabled: boolean) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [hasLicensed, setHasLicensed] = useState(false);

    useEffect(() => {
        if (!enabled || !currentUserId) {
            setHasLicensed(false);
            return undefined;
        }
        let active = true;
        vrchatEconomyRepository
            .getLicensedAvatars({ userId: currentUserId })
            .then((rows) => {
                if (active) {
                    setHasLicensed(rows.length > 0);
                }
            })
            .catch(() => {
                if (active) {
                    setHasLicensed(false);
                }
            });
        return () => {
            active = false;
        };
    }, [currentUserId, enabled]);

    return hasLicensed;
}
