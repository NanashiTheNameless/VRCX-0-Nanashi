import { useTranslation } from 'react-i18next';

import { MUTUAL_GRAPH_LAYOUT_LIMITS } from '@/lib/mutual-friends/mutualFriendsSettings';
import type {
    MutualFriendsLayoutSettingKey,
    MutualFriendsLayoutSettings
} from '@/lib/mutual-friends/mutualFriendsTypes';

import { CommitSlider } from './CommitSlider';

interface LayoutControl {
    key: MutualFriendsLayoutSettingKey;
    labelKey: string;
    helpKey: string;
    step: number;
    format: (value: number) => string;
}

const layoutControls: LayoutControl[] = [
    {
        key: 'layoutIterations',
        labelKey: 'view.charts.mutual_friend.settings.layout_iterations',
        helpKey: 'view.charts.mutual_friend.settings.layout_iterations_help',
        step: 100,
        format: (value) => String(value)
    },
    {
        key: 'layoutSpacing',
        labelKey: 'view.charts.mutual_friend.settings.layout_spacing',
        helpKey: 'view.charts.mutual_friend.settings.layout_spacing_help',
        step: 1,
        format: (value) => String(value)
    },
    {
        key: 'edgeCurvature',
        labelKey: 'view.charts.mutual_friend.settings.edge_curvature',
        helpKey: 'view.charts.mutual_friend.settings.edge_curvature_help',
        step: 0.01,
        format: (value) => value.toFixed(2)
    },
    {
        key: 'communitySeparation',
        labelKey: 'view.charts.mutual_friend.settings.community_separation',
        helpKey: 'view.charts.mutual_friend.settings.community_separation_help',
        step: 0.1,
        format: (value) => value.toFixed(1)
    }
];

export function MutualFriendsLayoutControls({
    layoutSettings,
    setLayoutSetting
}: {
    layoutSettings: MutualFriendsLayoutSettings;
    setLayoutSetting: (
        key: MutualFriendsLayoutSettingKey,
        value: number
    ) => void;
}) {
    const { t } = useTranslation();

    return layoutControls.map((control) => (
        <CommitSlider
            key={control.key}
            label={t(control.labelKey)}
            help={t(control.helpKey)}
            format={control.format}
            min={MUTUAL_GRAPH_LAYOUT_LIMITS[control.key].min}
            max={MUTUAL_GRAPH_LAYOUT_LIMITS[control.key].max}
            step={control.step}
            value={layoutSettings[control.key]}
            onCommit={(next) => setLayoutSetting(control.key, next)}
        />
    ));
}
