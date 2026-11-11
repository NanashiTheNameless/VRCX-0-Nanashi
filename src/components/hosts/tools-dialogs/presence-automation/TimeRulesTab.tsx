import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel
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
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import {
    AutomationSplitLayout,
    RuleEditorPanel,
    RuleList,
    RuleListItem,
    RuleSummaryBadge
} from './AutomationRuleLayout';
import {
    createTimeRule,
    dayOptions,
    daysSummary,
    getTimeWindow,
    hasGameRunningCondition,
    hasRuleAction,
    priorityLabelKeyFromNumber,
    priorityNumberFromValue,
    priorityOptions,
    priorityValueFromNumber,
    removeRuleAction,
    ruleActionSummary,
    ruleTitle,
    setGameRunningCondition,
    shouldRestorePreviousState,
    type TimeAutomationRule,
    type TimeWindowCondition,
    updateRule,
    updateRuleAction
} from './presenceAutomationDialogUtils';
import { PresenceRuleActionFields } from './PresenceRuleActionFields';
import { useRuleSelection } from './useRuleSelection';

const I18N_ROOT = 'view.tools.social_automation';
const TITLE_FALLBACK_KEY = `${I18N_ROOT}.schedule_rule_default`;

function updateTimeWindow(
    rule: TimeAutomationRule,
    patch: Partial<TimeWindowCondition>
): TimeAutomationRule {
    const timeWindow = getTimeWindow(rule);
    const otherConditions = (rule.conditions || []).filter(
        (condition) => condition.type !== 'timeWindow'
    );
    return {
        ...rule,
        conditions: [{ ...timeWindow, ...patch }, ...otherConditions]
    };
}

type TimeRulesTabProps = {
    disabled?: boolean;
    onRulesChange: (rules: TimeAutomationRule[]) => void;
    rules: TimeAutomationRule[];
};

export function TimeRulesTab({
    rules,
    disabled,
    onRulesChange
}: TimeRulesTabProps) {
    const { t } = useTranslation();
    const {
        selectedRule,
        selectedRuleId,
        setSelectedRuleId,
        removeRule: removeRuleFromSelection
    } = useRuleSelection(rules);
    const selectedTimeWindow = selectedRule
        ? getTimeWindow(selectedRule)
        : null;

    function update(
        ruleId: string,
        updater: (rule: TimeAutomationRule) => TimeAutomationRule
    ) {
        onRulesChange(updateRule(rules, ruleId, updater));
    }

    function addRule() {
        const nextRule = createTimeRule(
            t(`${I18N_ROOT}.scheduled_presence_default`)
        );
        setSelectedRuleId(nextRule.id);
        onRulesChange([...rules, nextRule]);
    }

    function removeRule(ruleId: string) {
        onRulesChange(removeRuleFromSelection(ruleId));
    }

    const list = (
        <RuleList
            title={t(`${I18N_ROOT}.schedule_rules`)}
            description={t(`${I18N_ROOT}.schedule_rules_description`)}
            addLabel={t(`${I18N_ROOT}.add_rule`)}
            disabled={disabled}
            isEmpty={!rules.length}
            emptyTitle={t('empty_state.schedule_rules_title')}
            emptyDescription={t('empty_state.schedule_rules_description')}
            onAdd={addRule}
        >
            {rules.map((rule) => {
                const timeWindow = getTimeWindow(rule);
                return (
                    <RuleListItem
                        key={rule.id}
                        selected={rule.id === selectedRuleId}
                        title={ruleTitle(rule, t, TITLE_FALLBACK_KEY)}
                        description={`${timeWindow.start} - ${timeWindow.end} / ${daysSummary(
                            timeWindow.days,
                            t
                        )}`}
                        enabled={rule.enabled !== false}
                        disabled={disabled}
                        removeLabel={t(`${I18N_ROOT}.remove_schedule_rule`)}
                        badges={
                            <>
                                <RuleSummaryBadge>
                                    {t(
                                        priorityLabelKeyFromNumber(
                                            rule.priority,
                                            'high'
                                        )
                                    )}
                                </RuleSummaryBadge>
                                <RuleSummaryBadge>
                                    {ruleActionSummary(rule, t)}
                                </RuleSummaryBadge>
                                {hasGameRunningCondition(rule) ? (
                                    <RuleSummaryBadge>
                                        {t(
                                            `${I18N_ROOT}.only_when_game_running`
                                        )}
                                    </RuleSummaryBadge>
                                ) : null}
                            </>
                        }
                        onSelect={() => setSelectedRuleId(rule.id)}
                        onEnabledChange={(checked) =>
                            update(rule.id, (current) => ({
                                ...current,
                                enabled: checked
                            }))
                        }
                        onRemove={() => removeRule(rule.id)}
                    />
                );
            })}
        </RuleList>
    );

    const editor = (
        <RuleEditorPanel
            title={
                selectedRule
                    ? ruleTitle(selectedRule, t, TITLE_FALLBACK_KEY)
                    : t(`${I18N_ROOT}.schedule_rule_default`)
            }
            description={
                selectedTimeWindow
                    ? `${selectedTimeWindow.start} - ${selectedTimeWindow.end}`
                    : t('empty_state.schedule_rules_title')
            }
        >
            {selectedRule && selectedTimeWindow ? (
                <FieldGroup>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                        <Field>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.rule_name`)}
                            </FieldLabel>
                            <Input
                                value={selectedRule.label || ''}
                                disabled={disabled}
                                onChange={(event) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        label: event.target.value
                                    }))
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel>
                                {t(`${I18N_ROOT}.priority`)}
                            </FieldLabel>
                            <Select
                                value={priorityValueFromNumber(
                                    selectedRule.priority,
                                    'high'
                                )}
                                disabled={disabled}
                                items={priorityOptions.map((option) => ({
                                    value: option.value,
                                    label: t(option.labelKey)
                                }))}
                                onValueChange={(value) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        priority: priorityNumberFromValue(
                                            value,
                                            700
                                        )
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {priorityOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {t(option.labelKey)}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.start`)}</FieldLabel>
                            <Input
                                type="time"
                                value={selectedTimeWindow.start}
                                disabled={disabled}
                                onChange={(event) =>
                                    update(selectedRule.id, (current) =>
                                        updateTimeWindow(current, {
                                            start: event.target.value
                                        })
                                    )
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel>{t(`${I18N_ROOT}.end`)}</FieldLabel>
                            <Input
                                type="time"
                                value={selectedTimeWindow.end}
                                disabled={disabled}
                                onChange={(event) =>
                                    update(selectedRule.id, (current) =>
                                        updateTimeWindow(current, {
                                            end: event.target.value
                                        })
                                    )
                                }
                            />
                        </Field>
                        <FieldDescription className="sm:col-span-2">
                            {t(`${I18N_ROOT}.same_start_end_hint`)}
                        </FieldDescription>
                    </div>
                    <Field>
                        <FieldLabel>{t(`${I18N_ROOT}.days`)}</FieldLabel>
                        <FieldDescription>
                            {t(`${I18N_ROOT}.run_every_day_hint`)}
                        </FieldDescription>
                        <ToggleGroup
                            multiple
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            value={(selectedTimeWindow.days || []).map(String)}
                            className="flex overflow-x-auto"
                            onValueChange={(values) =>
                                update(selectedRule.id, (current) =>
                                    updateTimeWindow(current, {
                                        days: values.map((value) =>
                                            Number.parseInt(value, 10)
                                        )
                                    })
                                )
                            }
                        >
                            {dayOptions.map((day, index) => (
                                <Fragment key={day.value}>
                                    {index > 0 ? (
                                        <ToggleGroupSeparator />
                                    ) : null}
                                    <ToggleGroupItem
                                        value={String(day.value)}
                                        disabled={disabled}
                                    >
                                        {t(day.labelKey)}
                                    </ToggleGroupItem>
                                </Fragment>
                            ))}
                        </ToggleGroup>
                    </Field>
                    <div className="flex flex-col gap-3 border-t pt-4">
                        <Field
                            orientation="horizontal"
                            data-disabled={disabled}
                        >
                            <Switch
                                id={`${selectedRule.id}-game-running`}
                                checked={hasGameRunningCondition(selectedRule)}
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                    update(selectedRule.id, (current) =>
                                        setGameRunningCondition(
                                            current,
                                            checked
                                        )
                                    )
                                }
                            />
                            <FieldContent>
                                <FieldLabel
                                    htmlFor={`${selectedRule.id}-game-running`}
                                >
                                    {t(`${I18N_ROOT}.only_when_game_running`)}
                                </FieldLabel>
                                <FieldDescription className="text-xs leading-snug">
                                    {t(
                                        `${I18N_ROOT}.only_when_game_running_description`
                                    )}
                                </FieldDescription>
                            </FieldContent>
                        </Field>
                        <Field
                            orientation="horizontal"
                            data-disabled={disabled}
                        >
                            <Switch
                                id={`${selectedRule.id}-restore-previous`}
                                checked={shouldRestorePreviousState(
                                    selectedRule
                                )}
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                    update(selectedRule.id, (current) => ({
                                        ...current,
                                        restorePreviousState: checked
                                    }))
                                }
                            />
                            <FieldContent>
                                <FieldLabel
                                    htmlFor={`${selectedRule.id}-restore-previous`}
                                >
                                    {t(`${I18N_ROOT}.restore_previous_status`)}
                                </FieldLabel>
                                <FieldDescription className="text-xs leading-snug">
                                    {t(
                                        `${I18N_ROOT}.restore_previous_status_description`
                                    )}
                                </FieldDescription>
                            </FieldContent>
                        </Field>
                    </div>
                    <PresenceRuleActionFields
                        idPrefix={selectedRule.id}
                        disabled={disabled}
                        status={selectedRule.actions?.status || 'no-change'}
                        statusDescriptionEnabled={hasRuleAction(
                            selectedRule,
                            'statusDescription'
                        )}
                        statusDescription={
                            selectedRule.actions?.statusDescription || ''
                        }
                        pronounsEnabled={hasRuleAction(
                            selectedRule,
                            'pronouns'
                        )}
                        pronouns={selectedRule.actions?.pronouns || ''}
                        onStatusChange={(value) =>
                            update(selectedRule.id, (current) =>
                                value === 'no-change'
                                    ? removeRuleAction(current, 'status')
                                    : updateRuleAction(current, {
                                          status: value
                                      })
                            )
                        }
                        onStatusDescriptionEnabledChange={(checked) =>
                            update(selectedRule.id, (current) =>
                                checked
                                    ? updateRuleAction(current, {
                                          statusDescription: ''
                                      })
                                    : removeRuleAction(
                                          current,
                                          'statusDescription'
                                      )
                            )
                        }
                        onStatusDescriptionChange={(value) =>
                            update(selectedRule.id, (current) =>
                                updateRuleAction(current, {
                                    statusDescription: value
                                })
                            )
                        }
                        onPronounsEnabledChange={(checked) =>
                            update(selectedRule.id, (current) =>
                                checked
                                    ? updateRuleAction(current, {
                                          pronouns: ''
                                      })
                                    : removeRuleAction(current, 'pronouns')
                            )
                        }
                        onPronounsChange={(value) =>
                            update(selectedRule.id, (current) =>
                                updateRuleAction(current, {
                                    pronouns: value
                                })
                            )
                        }
                    />
                </FieldGroup>
            ) : (
                <Empty className="min-h-[18rem] border">
                    <EmptyHeader>
                        <EmptyTitle>
                            {t('empty_state.schedule_rules_title')}
                        </EmptyTitle>
                        <EmptyDescription>
                            {t('empty_state.schedule_rules_description')}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )}
        </RuleEditorPanel>
    );

    return <AutomationSplitLayout list={list} editor={editor} />;
}
