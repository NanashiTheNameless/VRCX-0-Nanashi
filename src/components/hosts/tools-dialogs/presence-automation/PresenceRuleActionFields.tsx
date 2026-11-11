import { useTranslation } from 'react-i18next';

import { userStatusLabel } from '@/shared/utils/userStatus';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { statusOptions } from '../toolsDialogUtils';

const I18N_ROOT = 'view.tools.social_automation';

type PresenceRuleActionFieldsProps = {
    idPrefix: string;
    disabled?: boolean;
    status?: string;
    statusDescriptionEnabled: boolean;
    statusDescription: string;
    pronounsEnabled: boolean;
    pronouns: string;
    onStatusChange: (status: string) => void;
    onStatusDescriptionEnabledChange: (enabled: boolean) => void;
    onStatusDescriptionChange: (statusDescription: string) => void;
    onPronounsEnabledChange: (enabled: boolean) => void;
    onPronounsChange: (pronouns: string) => void;
};

const MAX_TEXT_LENGTH = 32;

function LimitedTextInput({
    id,
    value,
    disabled,
    placeholder,
    label,
    onChange
}: {
    id: string;
    value: string;
    disabled?: boolean;
    placeholder?: string;
    label: string;
    onChange: (value: string) => void;
}) {
    return (
        <Field className="sm:max-w-md">
            <div className="flex min-w-0 items-center gap-2">
                <Input
                    id={id}
                    className="min-w-0"
                    value={value}
                    maxLength={MAX_TEXT_LENGTH}
                    disabled={disabled}
                    placeholder={placeholder}
                    aria-label={label}
                    onChange={(event) => onChange(event.target.value)}
                />
                <FieldDescription className="shrink-0 text-xs tabular-nums">
                    {value.length}/{MAX_TEXT_LENGTH}
                </FieldDescription>
            </div>
        </Field>
    );
}

export function PresenceRuleActionFields({
    idPrefix,
    disabled,
    status,
    statusDescriptionEnabled,
    statusDescription,
    pronounsEnabled,
    pronouns,
    onStatusChange,
    onStatusDescriptionEnabledChange,
    onStatusDescriptionChange,
    onPronounsEnabledChange,
    onPronounsChange
}: PresenceRuleActionFieldsProps) {
    const { t } = useTranslation();
    const statusId = `${idPrefix}-status-action`;
    const statusDescriptionSwitchId = `${idPrefix}-status-description-action`;
    const statusDescriptionInputId = `${idPrefix}-status-description-input`;
    const pronounsSwitchId = `${idPrefix}-pronouns-action`;
    const pronounsInputId = `${idPrefix}-pronouns-input`;

    return (
        <FieldSet
            className="border-t pt-4"
            disabled={disabled}
            data-disabled={disabled}
        >
            <FieldLegend variant="label">
                {t(`${I18N_ROOT}.status`)}
            </FieldLegend>
            <FieldGroup className="gap-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <Field className="w-full sm:w-60">
                        <Select
                            value={status || 'no-change'}
                            disabled={disabled}
                            onValueChange={(value) =>
                                onStatusChange(value ?? '')
                            }
                            items={[
                                {
                                    value: 'no-change',
                                    label: t(`${I18N_ROOT}.do_not_change`)
                                },
                                ...statusOptions.map((statusOption) => ({
                                    value: statusOption,
                                    label: userStatusLabel(statusOption, t)
                                }))
                            ]}
                        >
                            <SelectTrigger
                                id={statusId}
                                aria-label={t(`${I18N_ROOT}.status`)}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="no-change">
                                        {t(`${I18N_ROOT}.do_not_change`)}
                                    </SelectItem>
                                    {statusOptions.map((statusOption) => (
                                        <SelectItem
                                            key={statusOption}
                                            value={statusOption}
                                        >
                                            {userStatusLabel(statusOption, t)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        orientation="horizontal"
                        className="w-auto"
                        data-disabled={disabled}
                    >
                        <Switch
                            id={statusDescriptionSwitchId}
                            checked={statusDescriptionEnabled}
                            disabled={disabled}
                            onCheckedChange={onStatusDescriptionEnabledChange}
                        />
                        <FieldLabel htmlFor={statusDescriptionSwitchId}>
                            {t(`${I18N_ROOT}.signature`)}
                        </FieldLabel>
                    </Field>
                    <Field
                        orientation="horizontal"
                        className="w-auto"
                        data-disabled={disabled}
                    >
                        <Switch
                            id={pronounsSwitchId}
                            checked={pronounsEnabled}
                            disabled={disabled}
                            onCheckedChange={onPronounsEnabledChange}
                        />
                        <FieldLabel htmlFor={pronounsSwitchId}>
                            {t(`${I18N_ROOT}.pronouns`)}
                        </FieldLabel>
                    </Field>
                </div>
                {statusDescriptionEnabled ? (
                    <LimitedTextInput
                        id={statusDescriptionInputId}
                        value={statusDescription}
                        disabled={disabled}
                        placeholder={t(
                            'view.settings.general.automation.status_description_placeholder'
                        )}
                        label={t(`${I18N_ROOT}.signature`)}
                        onChange={onStatusDescriptionChange}
                    />
                ) : null}
                {pronounsEnabled ? (
                    <LimitedTextInput
                        id={pronounsInputId}
                        value={pronouns}
                        disabled={disabled}
                        placeholder={t(`${I18N_ROOT}.pronouns_placeholder`)}
                        label={t(`${I18N_ROOT}.pronouns`)}
                        onChange={onPronounsChange}
                    />
                ) : null}
            </FieldGroup>
        </FieldSet>
    );
}
