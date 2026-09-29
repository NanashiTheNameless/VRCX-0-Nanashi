import { useEffect, useState } from 'react';

import configRepository from '@/repositories/configRepository';

export type MyGroupsSectionKey = 'own' | 'joined';

const sectionToggleKeys: Record<MyGroupsSectionKey, string> = {
    own: 'VRCX_MyGroupsOwnSectionOpen',
    joined: 'VRCX_MyGroupsJoinedSectionOpen'
};

export function useMyGroupsSectionPreferences() {
    const [openSections, setOpenSections] = useState<
        Record<MyGroupsSectionKey, boolean>
    >({ own: true, joined: true });

    useEffect(() => {
        let active = true;
        Promise.all([
            configRepository.getBool(sectionToggleKeys.own, true),
            configRepository.getBool(sectionToggleKeys.joined, true)
        ])
            .then(([own, joined]) => {
                if (active) {
                    setOpenSections({ own, joined });
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
