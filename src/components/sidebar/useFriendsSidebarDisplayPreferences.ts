import { usePreferencesStore } from '@/state/preferencesStore';

export function useFriendsSidebarDisplayPreferences() {
    const randomUserColours = usePreferencesStore(
        (state) => state.randomUserColours
    );
    const randomUserColourStyle = usePreferencesStore(
        (state) => state.randomUserColourStyle
    );
    const trustColor = usePreferencesStore((state) => state.trustColor);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const ageGatedInstancesVisiblePreference = usePreferencesStore(
        (state) => state.isAgeGatedInstancesVisible
    );
    const showInstanceIdInLocation = usePreferencesStore(
        (state) => state.showInstanceIdInLocation
    );
    const showSidebarAvatarFrame = usePreferencesStore(
        (state) => state.showSidebarAvatarFrame
    );
    const showSidebarNameplate = usePreferencesStore(
        (state) => state.showSidebarNameplate
    );
    const ageGatedInstancesVisible =
        preferencesHydrated && ageGatedInstancesVisiblePreference;

    return {
        ageGatedInstancesVisible,
        randomUserColours,
        randomUserColourStyle,
        showInstanceIdInLocation,
        showSidebarAvatarFrame,
        showSidebarNameplate,
        trustColor
    };
}
