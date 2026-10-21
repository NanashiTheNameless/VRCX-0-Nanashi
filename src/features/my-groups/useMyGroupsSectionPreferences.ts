import { useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';

export type MyGroupsSectionKey = 'own' | 'joined' | 'pending' | 'blocked';

const sectionToggleKeys: Record<MyGroupsSectionKey, string> = {
    own: 'VRCX_MyGroupsOwnSectionOpen',
    joined: 'VRCX_MyGroupsJoinedSectionOpen',
    pending: 'VRCX_MyGroupsPendingSectionOpen',
    blocked: 'VRCX_MyGroupsBlockedSectionOpen'
};

const sectionDefaults: Record<MyGroupsSectionKey, boolean> = {
    own: true,
    joined: true,
    pending: true,
    blocked: false
};

export function useMyGroupsSectionPreferences() {
    const [openSections, setOpenSections] =
        useState<Record<MyGroupsSectionKey, boolean>>(sectionDefaults);

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool(
                sectionToggleKeys.own,
                sectionDefaults.own
            ),
            configRepository.getBool(
                sectionToggleKeys.joined,
                sectionDefaults.joined
            ),
            configRepository.getBool(
                sectionToggleKeys.pending,
                sectionDefaults.pending
            ),
            configRepository.getBool(
                sectionToggleKeys.blocked,
                sectionDefaults.blocked
            )
        ])
            .then(([own, joined, pending, blocked]) => {
                if (active) {
                    setOpenSections({ own, joined, pending, blocked });
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    function toggleSection(key: MyGroupsSectionKey) {
        const nextOpen = !openSections[key];
        setOpenSections((current) => ({ ...current, [key]: nextOpen }));
        void configRepository.setBool(sectionToggleKeys[key], nextOpen);
    }

    return { openSections, toggleSection };
}
