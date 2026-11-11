import { describe, expect, it } from 'vitest';

import {
    buildContextConditions,
    createContextRule,
    createTimeRule,
    hasGameRunningCondition,
    normalizeContextRule,
    normalizeTimeRule,
    parseWorldIds,
    priorityLabelKeyFromNumber,
    priorityNumberFromValue,
    priorityValueFromNumber,
    removeRuleAction,
    ruleActionSummary,
    setContextPreset,
    setGameRunningCondition,
    updateRule,
    updateRuleAction,
    type ContextAutomationRule
} from './presenceAutomationDialogUtils';

describe('presenceAutomationDialogUtils priority mapping', () => {
    it('maps numeric priorities to high, medium, and low buckets', () => {
        expect(priorityValueFromNumber(700)).toBe('high');
        expect(priorityValueFromNumber(600)).toBe('high');
        expect(priorityValueFromNumber(599)).toBe('medium');
        expect(priorityValueFromNumber(300)).toBe('medium');
        expect(priorityValueFromNumber(299)).toBe('low');
        expect(priorityValueFromNumber('100')).toBe('low');
    });

    it('falls back for non-finite priority values', () => {
        expect(priorityValueFromNumber('bad')).toBe('medium');
        expect(priorityValueFromNumber(undefined, 'low')).toBe('low');
        expect(priorityValueFromNumber(Number.POSITIVE_INFINITY, 'high')).toBe(
            'high'
        );
    });

    it('resolves priority label keys through the numeric bucket fallback', () => {
        expect(priorityLabelKeyFromNumber(700)).toBe(
            'view.tools.social_automation.priority_high'
        );
        expect(priorityLabelKeyFromNumber(400)).toBe(
            'view.tools.social_automation.priority_medium'
        );
        expect(priorityLabelKeyFromNumber(100)).toBe(
            'view.tools.social_automation.priority_low'
        );
        expect(priorityLabelKeyFromNumber('bad', 'low')).toBe(
            'view.tools.social_automation.priority_low'
        );
        expect(priorityLabelKeyFromNumber('bad', 'unknown')).toBe(
            'view.tools.social_automation.priority_medium'
        );
    });

    it('maps priority select values back to rule numbers', () => {
        expect(priorityNumberFromValue('high')).toBe(700);
        expect(priorityNumberFromValue('medium')).toBe(400);
        expect(priorityNumberFromValue('low')).toBe(100);
        expect(priorityNumberFromValue('unknown')).toBe(400);
        expect(priorityNumberFromValue(undefined, 123)).toBe(123);
    });
});

describe('presenceAutomationDialogUtils rule contracts', () => {
    it('normalizes time rules while preserving future fields', () => {
        expect(
            normalizeTimeRule({
                id: 'time-rule',
                domain: 'time',
                futureRuleField: { enabled: true },
                conditions: [
                    {
                        type: 'timeWindow',
                        start: '21:00',
                        end: '02:00',
                        days: [1, 2],
                        futureConditionField: 'keep'
                    }
                ],
                actions: {
                    status: 'join me',
                    futureActionField: 7
                }
            })
        ).toMatchObject({
            id: 'time-rule',
            domain: 'time',
            futureRuleField: { enabled: true },
            conditions: [
                {
                    type: 'timeWindow',
                    start: '21:00',
                    end: '02:00',
                    days: [1, 2],
                    futureConditionField: 'keep'
                }
            ],
            actions: {
                status: 'join me',
                futureActionField: 7
            }
        });
    });

    it.each([
        ['alone', {}, { type: 'isAlone' }],
        ['withAnyone', {}, { type: 'withCompany' }],
        ['withAnyFriend', {}, { type: 'hasAnyFriend' }],
        [
            'friendCountAtLeast',
            { friendCountValue: 3 },
            { type: 'friendCount', op: '>=', value: 3 }
        ],
        [
            'playerCountAtLeast',
            { playerCountValue: 8 },
            { type: 'playerCount', op: '>=', value: 8 }
        ],
        [
            'withSelectedGroups',
            { selectedGroups: ['group:grp_a', 'local:Friends'] },
            {
                type: 'hasFriendInGroups',
                values: ['group:grp_a', 'local:Friends']
            }
        ],
        [
            'withSelectedFriend',
            { specificFriendIds: ['usr_a'] },
            { type: 'hasSpecificFriend', values: ['usr_a'] }
        ],
        [
            'inFavoriteWorlds',
            { selectedWorldGroups: ['group_1'] },
            { type: 'worldInFavoriteGroups', values: ['group_1'] }
        ],
        [
            'inSelectedGroupInstances',
            { selectedInstanceGroupIds: ['grp_a'] },
            { type: 'instanceGroupIn', values: ['grp_a'] }
        ]
    ])(
        'derives the %s preset from persisted editor fields',
        (preset, patch, expectedCondition) => {
            const rule = {
                id: 'context-rule',
                domain: 'context',
                preset,
                ...patch
            } as ContextAutomationRule;

            expect(buildContextConditions(rule)).toEqual([
                { type: 'isGameRunning' },
                expectedCondition
            ]);
        }
    );

    it('keeps instance type selection as an additional context condition', () => {
        expect(
            buildContextConditions({
                id: 'context-rule',
                domain: 'context',
                preset: 'alone',
                selectedInstanceTypes: ['public', 'groupPlus']
            })
        ).toEqual([
            { type: 'isGameRunning' },
            { type: 'isAlone' },
            {
                type: 'instanceTypeIn',
                values: ['public', 'groupPlus']
            }
        ]);
    });

    it('keeps only group instance types when switching to the group instance preset', () => {
        const rule = createContextRule('Context');

        expect(
            setContextPreset(
                { ...rule, selectedInstanceTypes: ['public', 'groupPlus'] },
                'inSelectedGroupInstances'
            ).selectedInstanceTypes
        ).toEqual(['groupPlus']);
        expect(
            setContextPreset(rule, 'withAnyone').selectedInstanceTypes
        ).toEqual(['public', 'friends+']);
    });

    it('rebuilds stale persisted conditions from the editable preset fields', () => {
        expect(
            normalizeContextRule({
                id: 'persisted-rule',
                domain: 'context',
                preset: 'friendCountAtLeast',
                friendCountValue: '4',
                selectedInstanceTypes: ['friends+'],
                conditions: [
                    { type: 'isAlone' },
                    { type: 'playerCount', op: '>=', value: 99 }
                ],
                actions: { status: 'ask me' }
            })
        ).toMatchObject({
            id: 'persisted-rule',
            friendCountValue: 4,
            conditions: [
                { type: 'isGameRunning' },
                { type: 'friendCount', op: '>=', value: 4 },
                { type: 'instanceTypeIn', values: ['friends+'] }
            ],
            actions: { status: 'ask me' }
        });
    });

    it('uses safe defaults for new and malformed rules', () => {
        const contextRule = createContextRule('Context');
        expect(contextRule).toMatchObject({
            enabled: true,
            domain: 'context',
            priority: 400,
            label: 'Context',
            preset: 'alone',
            selectedInstanceTypes: ['public', 'friends+'],
            friendCountValue: 1,
            playerCountValue: 1,
            conditions: [
                { type: 'isGameRunning' },
                { type: 'isAlone' },
                {
                    type: 'instanceTypeIn',
                    values: ['public', 'friends+']
                }
            ],
            actions: { status: 'join me' }
        });
        expect(
            normalizeContextRule({
                id: 'malformed-rule',
                preset: 'playerCountAtLeast',
                playerCountValue: 0,
                selectedGroups: 'not-an-array',
                actions: null
            })
        ).toMatchObject({
            playerCountValue: 1,
            selectedGroups: [],
            conditions: [
                { type: 'isGameRunning' },
                { type: 'playerCount', op: '>=', value: 1 }
            ],
            actions: {}
        });

        expect(createTimeRule('Night')).toMatchObject({
            enabled: true,
            domain: 'time',
            priority: 700,
            label: 'Night',
            restorePreviousState: true,
            conditions: [
                {
                    type: 'timeWindow',
                    start: '21:00',
                    end: '02:00',
                    days: []
                }
            ],
            actions: {}
        });
    });

    it('updates actions, game-running gates, and only the selected rule', () => {
        const first = {
            id: 'first',
            conditions: [{ type: 'isAlone' }],
            actions: { status: 'active', statusDescription: 'Busy' }
        };
        const second = { id: 'second', actions: {} };

        const withAction = updateRuleAction(first, { status: 'ask me' });
        expect(withAction.actions).toEqual({
            status: 'ask me',
            statusDescription: 'Busy'
        });
        expect(
            removeRuleAction(withAction, 'statusDescription').actions
        ).toEqual({ status: 'ask me' });

        const gated = setGameRunningCondition(first, true);
        expect(hasGameRunningCondition(gated)).toBe(true);
        expect(setGameRunningCondition(gated, false).conditions).toEqual([
            { type: 'isAlone' }
        ]);

        const updated = updateRule([first, second], 'first', (rule) => ({
            ...rule,
            enabled: false
        }));
        expect(updated[0]).toMatchObject({ id: 'first', enabled: false });
        expect(updated[1]).toBe(second);
    });
});

describe('presenceAutomationDialogUtils game mode, worlds and match mode', () => {
    it('adds game mode and world conditions before instance types', () => {
        expect(
            buildContextConditions({
                id: 'rule',
                domain: 'context',
                preset: 'inSelectedInstanceTypes',
                gameMode: 'vr',
                selectedWorldIds: ['wrld_a'],
                selectedInstanceTypes: ['public']
            })
        ).toEqual([
            { type: 'isGameRunning' },
            { type: 'gameMode', value: 'vr' },
            { type: 'worldIn', values: ['wrld_a'] },
            { type: 'instanceTypeIn', values: ['public'] }
        ]);
    });

    it('normalizes unknown modes to the defaults and keeps valid ones', () => {
        expect(
            normalizeContextRule({
                id: 'rule',
                conditionMatch: 'sometimes',
                gameMode: 'phone',
                selectedWorldIds: ['wrld_a', 'not a world', 'wrld_a']
            })
        ).toMatchObject({
            conditionMatch: 'all',
            gameMode: 'any',
            selectedWorldIds: ['wrld_a']
        });
        expect(
            normalizeContextRule({
                id: 'rule',
                conditionMatch: 'any',
                gameMode: 'desktop'
            })
        ).toMatchObject({ conditionMatch: 'any', gameMode: 'desktop' });
    });

    it('reads world ids out of pasted text and links', () => {
        expect(
            parseWorldIds(
                'https://vrchat.com/home/world/wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd/info, wrld_b wrld_b'
            )
        ).toEqual(['wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd', 'wrld_b']);
        expect(parseWorldIds('no ids here')).toEqual([]);
    });

    it('lists pronouns in the action summary', () => {
        const t = ((key: string) => key) as never;
        expect(
            ruleActionSummary(
                {
                    id: 'rule',
                    actions: { pronouns: 'they/them' }
                },
                t
            )
        ).toBe('view.tools.social_automation.pronouns');
    });
});
