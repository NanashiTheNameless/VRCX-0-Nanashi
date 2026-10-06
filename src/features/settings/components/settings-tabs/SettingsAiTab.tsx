import { SettingsTabContent } from '../SettingsViewParts';
import { AssistantSettingsGroup } from './AssistantSettingsGroup';
import { McpServerSettingsGroup } from './McpServerSettingsGroup';
import { SettingsRemindersCard } from './SettingsRemindersCard';

type SettingsAiTabProps = {
    active: boolean;
};

export function SettingsAiTab({ active }: SettingsAiTabProps) {
    return (
        <SettingsTabContent value="ai">
            <AssistantSettingsGroup active={active} />
            {active ? <SettingsRemindersCard /> : null}
            <McpServerSettingsGroup />
        </SettingsTabContent>
    );
}
