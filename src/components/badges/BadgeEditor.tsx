import { PlusIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { CustomBadgeChip } from '@/components/UserBadges';
import {
    BADGE_AGE_LEVELS,
    BADGE_MODERATIONS,
    BADGE_PLATFORMS,
    BADGE_RULE_OPERATORS,
    BADGE_STATUSES,
    BADGE_TEXT_MATCHES,
    CUSTOM_BADGE_FRIEND_NUMBER_MAX,
    CUSTOM_BADGE_GROUP_DEPTH_LIMIT,
    CUSTOM_BADGE_GROUP_MEMBER_LIMIT,
    CUSTOM_BADGE_LABEL_MAX,
    CUSTOM_BADGE_MEMO_MAX,
    DEFAULT_CUSTOM_BADGE_COLOR,
    DEFAULT_CUSTOM_BADGE_ICON,
    compileBadgeRegex,
    createCustomBadgeId,
    extractBadgeUserIds,
    isBadgeTextRule,
    enabledBadgeRules,
    isGroupMemberListTruncated,
    normalizeBadgeColor,
    type CustomBadge,
    type CustomBadgeRule,
    type CustomBadgeRuleKind,
    type BadgeRuleOperator,
    isReservedBadgeIcon
} from '@/domain/badges/customBadges';
import type { GroupRoleRecord } from '@/domain/entities/group';
import { buildFeedFavoriteGroupOptions } from '@/domain/feed/feedFavoriteGroups';
import { formatDateFilter } from '@/lib/dateTime';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { toast } from '@/services/toastService';
import { TRUST_COLOR_ENTRIES } from '@/shared/constants/trustColors';
import { languageOptionLabel } from '@/shared/utils/userLanguage';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

import { useSpokenLanguageSelection } from '../dialogs/useSpokenLanguageSelection';
import { BadgeIconPicker } from './BadgeIconPicker';
import { BadgeRuleGuide } from './BadgeRuleGuide';
import { BadgeRuleMap } from './BadgeRuleMap';
import {
    SIMPLE_BADGE_OPERATORS,
    describeCustomBadge,
    isSimpleBadgeOperator,
    usesAdvancedBadgeLogic
} from './badgeRuleText';

const T = 'view.settings.appearance.user_badges';

const COLOR_PRESETS = [
    '#3b82f6',
    '#22c55e',
    '#eab308',
    '#f97316',
    '#a855f7',
    '#ec4899',
    '#14b8a6',
    '#64748b'
];

const RULE_KINDS: CustomBadgeRuleKind[] = [
    'users',
    'self',
    'friends',
    'friendGroup',
    'vrchatGroup',
    'trust',
    'supporter',
    'ageVerified',
    'platform',
    'status',
    'language',
    'friendNumber',
    'moderation',
    'displayName',
    'statusText',
    'memo',
    'bio',
    'pronouns'
];

const NO_LANGUAGE_KEYS: readonly string[] = [];

// Option keys for the translation file, which cannot hold the spaces in
// VRChat's status values.
const optionKey = (value: string) => value.replace(/\W+/g, '_');

function OptionSelect<V extends string>({
    value,
    values,
    labelPrefix,
    label,
    className = 'w-56',
    onValueChange
}: {
    value: V;
    values: readonly V[];
    labelPrefix: string;
    label?: string;
    className?: string;
    onValueChange: (value: V) => void;
}) {
    const { t } = useTranslation();
    return (
        <Select
            value={value}
            onValueChange={(next) => {
                const match = values.find((entry) => entry === next);
                if (match) {
                    onValueChange(match);
                }
            }}
        >
            <SelectTrigger className={className} aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {values.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                        {t(`${labelPrefix}.${optionKey(entry)}`)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function newRule(kind: CustomBadgeRuleKind): CustomBadgeRule {
    switch (kind) {
        case 'group':
            return { kind, operator: 'or', rules: [] };
        case 'users':
            return { kind, userIds: [] };
        case 'friendGroup':
            return { kind, groupKey: '' };
        case 'vrchatGroup':
            return {
                kind,
                groupId: '',
                groupName: '',
                roleId: '',
                roleName: '',
                memberIds: [],
                refreshedAt: 0,
                truncated: false
            };
        case 'trust':
            return { kind, trustKey: 'known' };
        case 'ageVerified':
            return { kind, level: 'any' };
        case 'platform':
            return { kind, platform: 'standalonewindows' };
        case 'status':
            return { kind, status: 'join me' };
        case 'displayName':
        case 'statusText':
        case 'memo':
        case 'bio':
        case 'pronouns':
            return { kind, contains: '' };
        case 'language':
            return { kind, language: 'eng' };
        case 'friendNumber':
            return { kind, min: 1, max: 0 };
        case 'moderation':
            return { kind, moderation: 'block' };
        case 'self':
        case 'friends':
        case 'supporter':
            return { kind };
    }
}

export function newBadge(): CustomBadge {
    return {
        id: createCustomBadgeId(),
        label: '',
        icon: DEFAULT_CUSTOM_BADGE_ICON,
        color: DEFAULT_CUSTOM_BADGE_COLOR,
        enabled: true,
        rules: []
    };
}

type GroupOption = { id: string; name: string };

function useMyGroups(enabled: boolean): GroupOption[] {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [groups, setGroups] = useState<GroupOption[]>([]);
    useEffect(() => {
        if (!enabled || !currentUserId) {
            return;
        }
        let active = true;
        groupProfileRepository
            .getUserGroups({ userId: currentUserId })
            .then((rows) => {
                if (!active) {
                    return;
                }
                setGroups(
                    rows
                        .map((row) => ({
                            id: String(row.id || ''),
                            name: String(row.name || row.id || '')
                        }))
                        .filter((row) => row.id.startsWith('grp_'))
                        .sort((a, b) => a.name.localeCompare(b.name))
                );
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, [currentUserId, enabled]);
    return groups;
}

function VrchatGroupRuleEditor({
    rule,
    onChange
}: {
    rule: Extract<CustomBadgeRule, { kind: 'vrchatGroup' }>;
    onChange: (rule: CustomBadgeRule) => void;
}) {
    const { t } = useTranslation();
    const myGroups = useMyGroups(true);
    const [groupInput, setGroupInput] = useState(rule.groupId);
    const [roles, setRoles] = useState<GroupRoleRecord[]>([]);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!rule.groupId) {
            setRoles([]);
            return;
        }
        let active = true;
        groupProfileRepository
            .getGroupProfile({ groupId: rule.groupId, includeRoles: true })
            .then((profile) => {
                if (active) {
                    setRoles(Array.isArray(profile.roles) ? profile.roles : []);
                }
            })
            .catch(() => {
                if (active) {
                    setRoles([]);
                }
            });
        return () => {
            active = false;
        };
    }, [rule.groupId]);

    function selectGroup(groupId: string, groupName: string) {
        setGroupInput(groupId);
        onChange({
            ...rule,
            groupId,
            groupName,
            roleId: '',
            roleName: '',
            memberIds: [],
            refreshedAt: 0,
            truncated: false
        });
    }

    async function fetchMembers() {
        if (!rule.groupId) {
            return;
        }
        setBusy(true);
        try {
            const [profile, members] = await Promise.all([
                groupProfileRepository
                    .getGroupProfile({ groupId: rule.groupId })
                    .catch(() => null),
                groupProfileRepository.getAllGroupMembers({
                    groupId: rule.groupId,
                    roleId: rule.roleId,
                    force: true
                })
            ]);
            const ids = members
                .map((member) => String(member.userId || member.user?.id || ''))
                .filter(Boolean);
            onChange({
                ...rule,
                groupName: String(profile?.name || rule.groupName || ''),
                memberIds: ids.slice(0, CUSTOM_BADGE_GROUP_MEMBER_LIMIT),
                truncated: isGroupMemberListTruncated(
                    ids.length,
                    Number(profile?.memberCount) || 0,
                    Boolean(rule.roleId)
                ),
                refreshedAt: Math.floor(Date.now() / 1000)
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: t(`${T}.group_fetch_failed`),
                description: error instanceof Error ? error.message : ''
            });
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                {myGroups.length ? (
                    <Select
                        value={
                            myGroups.some((group) => group.id === rule.groupId)
                                ? rule.groupId
                                : ''
                        }
                        onValueChange={(value) => {
                            const group = myGroups.find(
                                (entry) => entry.id === value
                            );
                            if (group) {
                                selectGroup(group.id, group.name);
                            }
                        }}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder={t(`${T}.group_pick`)} />
                        </SelectTrigger>
                        <SelectContent>
                            {myGroups.map((group) => (
                                <SelectItem key={group.id} value={group.id}>
                                    {group.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : null}
                <Input
                    className="w-64"
                    value={groupInput}
                    placeholder="grp_..."
                    aria-label={t(`${T}.group_id`)}
                    onChange={(event) => setGroupInput(event.target.value)}
                    onBlur={() => {
                        const match =
                            groupInput.match(/grp_[0-9a-f-]{36}/i)?.[0];
                        if (match && match !== rule.groupId) {
                            selectGroup(match, '');
                        } else if (!match) {
                            setGroupInput(rule.groupId);
                        }
                    }}
                />
            </div>
            {rule.groupId ? (
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={rule.roleId || 'all'}
                        onValueChange={(value) => {
                            const role = roles.find(
                                (entry) => entry.id === value
                            );
                            onChange({
                                ...rule,
                                roleId: role?.id || '',
                                roleName: role?.name || '',
                                memberIds: [],
                                refreshedAt: 0,
                                truncated: false
                            });
                        }}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">
                                {t(`${T}.group_all_roles`)}
                            </SelectItem>
                            {roles
                                .filter((role) => role.id)
                                .map((role) => (
                                    <SelectItem
                                        key={role.id}
                                        value={String(role.id)}
                                    >
                                        {role.name || role.id}
                                    </SelectItem>
                                ))}
                        </SelectContent>
                    </Select>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void fetchMembers()}
                    >
                        {busy ? <Spinner /> : <RefreshCwIcon />}
                        {rule.refreshedAt
                            ? t(`${T}.group_refresh`)
                            : t(`${T}.group_fetch`)}
                    </Button>
                    <span className="text-muted-foreground text-xs">
                        {rule.refreshedAt
                            ? t(`${T}.group_members`, {
                                  count: rule.memberIds.length,
                                  date: formatDateFilter(
                                      new Date(rule.refreshedAt * 1000),
                                      'long'
                                  )
                              })
                            : t(`${T}.group_not_fetched`)}
                        {rule.truncated
                            ? ` ${t(`${T}.group_truncated`, {
                                  limit: CUSTOM_BADGE_GROUP_MEMBER_LIMIT
                              })}`
                            : ''}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

function GateSentence({
    lead,
    leadOne,
    rules,
    operator,
    advanced,
    onChange
}: {
    lead: string;
    leadOne: string;
    rules: readonly CustomBadgeRule[];
    operator: BadgeRuleOperator;
    advanced: boolean;
    onChange: (operator: BadgeRuleOperator) => void;
}) {
    const { t } = useTranslation();
    const enabledCount = enabledBadgeRules(rules).length;
    if (enabledCount === 0) {
        return (
            <p className="text-muted-foreground text-xs">
                {t(`${T}.no_enabled_conditions`)}
            </p>
        );
    }
    if (enabledCount === 1) {
        return <span className="text-sm font-medium">{leadOne}</span>;
    }
    const values =
        advanced || !isSimpleBadgeOperator(operator)
            ? BADGE_RULE_OPERATORS
            : SIMPLE_BADGE_OPERATORS;
    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{lead}</span>
                <OptionSelect
                    className="w-44"
                    value={operator}
                    values={values}
                    labelPrefix={`${T}.match`}
                    label={t(`${T}.combine_rules`)}
                    onValueChange={onChange}
                />
                <span>{t(`${T}.sentence.of`)}</span>
            </div>
            {advanced ? (
                <p className="text-muted-foreground text-xs">
                    {t(`${T}.operator_description.${operator}`)}
                </p>
            ) : null}
        </div>
    );
}

function RuleEditor({
    rule,
    onChange,
    onRemove,
    depth,
    advanced,
    allowToggles = true
}: {
    rule: CustomBadgeRule;
    onChange: (rule: CustomBadgeRule) => void;
    onRemove: () => void;
    depth: number;
    advanced: boolean;
    allowToggles?: boolean;
}) {
    const { t } = useTranslation();
    const friendGroups = useFavoriteStore(
        useShallow((state) => ({
            favoriteFriendGroups: state.favoriteFriendGroups,
            localFriendFavoriteGroups: state.localFriendFavoriteGroups
        }))
    );
    const friendGroupOptions = useMemo(
        () => buildFeedFavoriteGroupOptions(friendGroups),
        [friendGroups]
    );
    const [userText, setUserText] = useState(
        rule.kind === 'users' ? rule.userIds.join('\n') : ''
    );
    const enabled = rule.enabled !== false;

    let body = null;
    switch (rule.kind) {
        case 'group':
            body = (
                <RulesEditor
                    rules={rule.rules}
                    depth={depth + 1}
                    advanced={advanced}
                    onChange={(rules) => onChange({ ...rule, rules })}
                />
            );
            break;
        case 'users':
            body = (
                <div className="flex flex-col gap-1">
                    <Textarea
                        rows={3}
                        value={userText}
                        placeholder={t(`${T}.users_placeholder`)}
                        aria-label={t(`${T}.rule.users`)}
                        onChange={(event) => setUserText(event.target.value)}
                        onBlur={() => {
                            const userIds = extractBadgeUserIds(userText);
                            setUserText(userIds.join('\n'));
                            onChange({ ...rule, userIds });
                        }}
                    />
                    <span className="text-muted-foreground text-xs">
                        {t(`${T}.users_count`, { count: rule.userIds.length })}
                    </span>
                </div>
            );
            break;
        case 'friendGroup':
            body = (
                <Select
                    value={rule.groupKey}
                    onValueChange={(value) =>
                        onChange({ ...rule, groupKey: String(value || '') })
                    }
                >
                    <SelectTrigger
                        className="w-64"
                        aria-label={t(`${T}.rule.friendGroup`)}
                    >
                        <SelectValue
                            placeholder={t(`${T}.friend_group_pick`)}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {friendGroupOptions.map((option) => (
                            <SelectItem key={option.key} value={option.key}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
            break;
        case 'vrchatGroup':
            body = <VrchatGroupRuleEditor rule={rule} onChange={onChange} />;
            break;
        case 'trust':
            body = (
                <Select
                    value={rule.trustKey}
                    onValueChange={(value) => {
                        const entry = TRUST_COLOR_ENTRIES.find(
                            (item) => item.key === value
                        );
                        if (entry) {
                            onChange({ ...rule, trustKey: entry.key });
                        }
                    }}
                >
                    <SelectTrigger
                        className="w-56"
                        aria-label={t(`${T}.rule.trust`)}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {TRUST_COLOR_ENTRIES.map((entry) => (
                            <SelectItem key={entry.key} value={entry.key}>
                                {t(entry.labelKey)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
            break;
        case 'ageVerified':
            body = (
                <OptionSelect
                    value={rule.level}
                    values={BADGE_AGE_LEVELS}
                    labelPrefix={`${T}.age_level`}
                    label={t(`${T}.rule.ageVerified`)}
                    onValueChange={(level) => onChange({ ...rule, level })}
                />
            );
            break;
        case 'platform':
            body = (
                <OptionSelect
                    value={rule.platform}
                    values={BADGE_PLATFORMS}
                    labelPrefix={`${T}.platform_option`}
                    label={t(`${T}.rule.platform`)}
                    onValueChange={(platform) =>
                        onChange({ ...rule, platform })
                    }
                />
            );
            break;
        case 'status':
            body = (
                <OptionSelect
                    value={rule.status}
                    values={BADGE_STATUSES}
                    labelPrefix={`${T}.status_option`}
                    label={t(`${T}.rule.status`)}
                    onValueChange={(status) => onChange({ ...rule, status })}
                />
            );
            break;
        case 'displayName':
        case 'statusText':
        case 'memo':
        case 'bio':
        case 'pronouns':
            body = <TextRuleEditor rule={rule} onChange={onChange} />;
            break;
        case 'language':
            body = <LanguageRuleEditor rule={rule} onChange={onChange} />;
            break;
        case 'friendNumber':
            body = (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1.5">
                        {t(`${T}.friend_number_min`)}
                        <Input
                            type="number"
                            className="w-28"
                            min={0}
                            max={CUSTOM_BADGE_FRIEND_NUMBER_MAX}
                            value={rule.min}
                            onChange={(event) =>
                                onChange({
                                    ...rule,
                                    min: friendNumberInput(event.target.value)
                                })
                            }
                        />
                    </label>
                    <label className="flex items-center gap-1.5">
                        {t(`${T}.friend_number_max`)}
                        <Input
                            type="number"
                            className="w-28"
                            min={0}
                            max={CUSTOM_BADGE_FRIEND_NUMBER_MAX}
                            value={rule.max || ''}
                            placeholder={t(`${T}.friend_number_no_max`)}
                            onChange={(event) =>
                                onChange({
                                    ...rule,
                                    max: friendNumberInput(event.target.value)
                                })
                            }
                        />
                    </label>
                    {rule.max > 0 && rule.max < rule.min ? (
                        <span className="text-destructive">
                            {t(`${T}.friend_number_invalid`)}
                        </span>
                    ) : null}
                </div>
            );
            break;
        case 'moderation':
            body = (
                <OptionSelect
                    value={rule.moderation}
                    values={BADGE_MODERATIONS}
                    labelPrefix={`${T}.moderation_option`}
                    label={t(`${T}.rule.moderation`)}
                    onValueChange={(moderation) =>
                        onChange({ ...rule, moderation })
                    }
                />
            );
            break;
        case 'self':
        case 'friends':
        case 'supporter':
            body = null;
            break;
    }

    const heading =
        rule.kind === 'group' ? (
            <GateSentence
                lead={t(`${T}.sentence.group_lead`)}
                leadOne={t(`${T}.sentence.group_lead_one`)}
                rules={rule.rules}
                operator={rule.operator}
                advanced={advanced}
                onChange={(operator) => onChange({ ...rule, operator })}
            />
        ) : (
            <span
                className="text-sm font-medium"
                title={t(`${T}.rule_description.${rule.kind}`)}
            >
                {isBadgeTextRule(rule)
                    ? t(
                          `${T}.${rule.negated ? 'text_phrase_not' : 'text_phrase'}`,
                          { field: t(`${T}.text_field.${rule.kind}`) }
                      )
                    : t(
                          `${T}.${rule.negated ? 'phrase_not' : 'phrase'}.${rule.kind}`
                      )}
            </span>
        );

    return (
        <div
            className={`flex min-w-0 flex-col gap-2 rounded-md border p-2 ${enabled ? '' : 'border-dashed opacity-60'}`}
        >
            <div className="flex flex-wrap items-center gap-2">
                {allowToggles ? (
                    <label className="flex shrink-0 items-center gap-1.5 text-xs">
                        <Checkbox
                            checked={enabled}
                            onCheckedChange={(checked) =>
                                onChange({ ...rule, enabled: checked === true })
                            }
                        />
                        {t(`${T}.rule_enabled`)}
                    </label>
                ) : null}
                <div className="min-w-0 flex-1">{heading}</div>
                <div className="flex shrink-0 items-center gap-2">
                    {allowToggles ? (
                        <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                                checked={rule.negated === true}
                                onCheckedChange={(negated) =>
                                    onChange({
                                        ...rule,
                                        negated: negated === true
                                    })
                                }
                            />
                            {t(`${T}.negate`)}
                        </label>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(`${T}.remove_rule`)}
                        onClick={onRemove}
                    >
                        <XIcon />
                    </Button>
                </div>
            </div>
            {rule.kind !== 'group' ? (
                <span className="text-muted-foreground text-xs">
                    {t(`${T}.rule_description.${rule.kind}`)}
                </span>
            ) : null}
            {body}
        </div>
    );
}

function friendNumberInput(value: string): number {
    const number = Math.floor(Number(value));
    return Number.isFinite(number)
        ? Math.min(Math.max(number, 0), CUSTOM_BADGE_FRIEND_NUMBER_MAX)
        : 0;
}

type TextRule = Extract<CustomBadgeRule, { contains: string }>;

function TextRuleEditor({
    rule,
    onChange
}: {
    rule: TextRule;
    onChange: (rule: CustomBadgeRule) => void;
}) {
    const { t } = useTranslation();
    const match = rule.match ?? 'contains';
    const invalidRegex =
        match === 'regex' &&
        rule.contains !== '' &&
        compileBadgeRegex(rule.contains) === null;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <OptionSelect
                value={match}
                values={BADGE_TEXT_MATCHES}
                labelPrefix={`${T}.text_match`}
                label={t(`${T}.text_match_label`)}
                className="w-44"
                onValueChange={(next) => {
                    const { match: _previous, ...rest } = rule;
                    onChange(
                        next === 'contains' ? rest : { ...rest, match: next }
                    );
                }}
            />
            {match !== 'any' ? (
                <Input
                    className="w-64"
                    maxLength={CUSTOM_BADGE_MEMO_MAX}
                    value={rule.contains}
                    placeholder={t(
                        match === 'regex'
                            ? `${T}.regex_placeholder`
                            : `${T}.memo_placeholder`
                    )}
                    aria-label={t(`${T}.rule.${rule.kind}`)}
                    aria-invalid={invalidRegex || undefined}
                    onChange={(event) =>
                        onChange({ ...rule, contains: event.target.value })
                    }
                />
            ) : null}
            {invalidRegex ? (
                <span className="text-destructive text-xs">
                    {t(`${T}.regex_invalid`)}
                </span>
            ) : null}
        </div>
    );
}

function LanguageRuleEditor({
    rule,
    onChange
}: {
    rule: Extract<CustomBadgeRule, { kind: 'language' }>;
    onChange: (rule: CustomBadgeRule) => void;
}) {
    const { t } = useTranslation();
    const { availableLanguageOptions } =
        useSpokenLanguageSelection(NO_LANGUAGE_KEYS);
    const options = availableLanguageOptions.some(
        (option) => option.key === rule.language
    )
        ? availableLanguageOptions
        : [{ key: rule.language, value: '' }, ...availableLanguageOptions];
    return (
        <Select
            value={rule.language}
            onValueChange={(value) => {
                if (value) {
                    onChange({ ...rule, language: String(value) });
                }
            }}
        >
            <SelectTrigger
                className="w-64"
                aria-label={t(`${T}.rule.language`)}
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                        {languageOptionLabel(option)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

let ruleKeyCounter = 0;

// Rules have no id of their own; the editor gives each one a key that stays
// with it, so removing a rule never hands its editor state to the next one.
function nextRuleKey(): string {
    ruleKeyCounter += 1;
    return `rule-${ruleKeyCounter}`;
}

function RulesEditor({
    rules,
    onChange,
    advanced,
    depth = 0
}: {
    rules: CustomBadgeRule[];
    onChange: (rules: CustomBadgeRule[]) => void;
    advanced: boolean;
    depth?: number;
}) {
    const { t } = useTranslation();
    const [ruleKeys, setRuleKeys] = useState(() =>
        rules.map(() => nextRuleKey())
    );

    function add(rule: CustomBadgeRule) {
        onChange([...rules, rule]);
        setRuleKeys((current) => [...current, nextRuleKey()]);
    }

    return (
        <div
            className="flex min-w-0 flex-col gap-2"
            role="group"
            aria-label={t(`${T}.condition_tree`)}
        >
            {rules.length ? (
                <div className="ml-2 flex min-w-0 flex-col gap-2 border-l-2 pl-4">
                    {rules.map((rule, index) => (
                        <div
                            key={ruleKeys[index]}
                            className="relative min-w-0 before:absolute before:top-5 before:-left-4 before:w-4 before:border-t-2"
                        >
                            <RuleEditor
                                rule={rule}
                                depth={depth}
                                advanced={advanced}
                                onChange={(next) =>
                                    onChange(
                                        rules.map((entry, i) =>
                                            i === index ? next : entry
                                        )
                                    )
                                }
                                onRemove={() => {
                                    onChange(
                                        rules.filter((_, i) => i !== index)
                                    );
                                    setRuleKeys((current) =>
                                        current.filter((_, i) => i !== index)
                                    );
                                }}
                            />
                        </div>
                    ))}
                </div>
            ) : depth === 0 ? (
                <span className="text-muted-foreground text-sm">
                    {t(`${T}.no_rules`)}
                </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                <Select
                    value=""
                    onValueChange={(value) => {
                        const kind = RULE_KINDS.find(
                            (entry) => entry === value
                        );
                        if (kind) {
                            add(newRule(kind));
                        }
                    }}
                >
                    <SelectTrigger
                        size="sm"
                        className="w-56"
                        aria-label={t(`${T}.add_condition`)}
                    >
                        <PlusIcon />
                        <SelectValue
                            placeholder={t(`${T}.add_condition_pick`)}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {RULE_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                                {t(`${T}.rule.${kind}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {depth < CUSTOM_BADGE_GROUP_DEPTH_LIMIT ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => add(newRule('group'))}
                    >
                        <PlusIcon />
                        {t(`${T}.add_branch`)}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

export function BadgeEditor({
    initial,
    onCancel,
    onSave
}: {
    initial: CustomBadge;
    onCancel: () => void;
    onSave: (badge: CustomBadge) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(initial);
    const [advanced, setAdvanced] = useState(() =>
        usesAdvancedBadgeLogic(initial.operator ?? 'or', initial.rules)
    );
    const label = draft.label.trim();
    const operator = draft.operator ?? 'or';
    const friendGroupLabels = useFriendGroupLabels();
    const chip = (
        <CustomBadgeChip
            badge={{ ...draft, label: label || t(`${T}.map.result`) }}
            size="full"
        />
    );

    return (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    className="w-56"
                    maxLength={CUSTOM_BADGE_LABEL_MAX}
                    value={draft.label}
                    placeholder={t(`${T}.label_placeholder`)}
                    aria-label={t(`${T}.label`)}
                    onChange={(event) =>
                        setDraft({ ...draft, label: event.target.value })
                    }
                />
                <BadgeIconPicker
                    value={draft.icon}
                    onValueChange={(icon) => setDraft({ ...draft, icon })}
                />
                <input
                    type="color"
                    className="h-8 w-10 cursor-pointer rounded border bg-transparent"
                    value={draft.color}
                    aria-label={t(`${T}.color`)}
                    onChange={(event) =>
                        setDraft({
                            ...draft,
                            color: normalizeBadgeColor(event.target.value)
                        })
                    }
                />
                <div className="flex gap-1">
                    {COLOR_PRESETS.map((color) => (
                        <button
                            key={color}
                            type="button"
                            className="size-5 cursor-pointer rounded-full border"
                            style={{ background: color }}
                            aria-label={color}
                            onClick={() => setDraft({ ...draft, color })}
                        />
                    ))}
                </div>
                {label ? (
                    <CustomBadgeChip badge={{ ...draft, label }} size="full" />
                ) : null}
            </div>
            {isReservedBadgeIcon(draft.icon) ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t(`${T}.icon_now_reserved_detail`)}
                </p>
            ) : null}
            {draft.assignedUserIds?.length ? (
                <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs">
                        {t(`${T}.assigned_users`)}
                    </p>
                    <RuleEditor
                        rule={{ kind: 'users', userIds: draft.assignedUserIds }}
                        depth={0}
                        advanced={advanced}
                        allowToggles={false}
                        onChange={(rule) => {
                            if (rule.kind === 'users')
                                setDraft({
                                    ...draft,
                                    assignedUserIds: rule.userIds
                                });
                        }}
                        onRemove={() =>
                            setDraft({ ...draft, assignedUserIds: [] })
                        }
                    />
                </div>
            ) : null}
            <GateSentence
                lead={t(`${T}.sentence.lead`)}
                leadOne={t(`${T}.sentence.lead_one`)}
                rules={draft.rules}
                operator={operator}
                advanced={advanced}
                onChange={(next) =>
                    setDraft((current) => ({ ...current, operator: next }))
                }
            />
            <RulesEditor
                rules={draft.rules}
                advanced={advanced}
                onChange={(rules) =>
                    setDraft((current) => ({
                        ...current,
                        rules,
                        operator: current.operator ?? 'or'
                    }))
                }
            />
            <div className="flex flex-col gap-1 rounded-md border p-2">
                <span className="text-muted-foreground text-xs font-medium">
                    {t(`${T}.summary.title`)}
                </span>
                <p className="text-sm" data-testid="badge-rule-summary">
                    {describeCustomBadge(draft, t, {
                        friendGroupLabel: friendGroupLabels
                    })}
                </p>
            </div>
            <BadgeRuleMap
                rules={draft.rules}
                operator={operator}
                badge={chip}
                options={{ friendGroupLabel: friendGroupLabels }}
            />
            <label className="flex items-center gap-2 text-xs">
                <Switch checked={advanced} onCheckedChange={setAdvanced} />
                {t(`${T}.advanced`)}
            </label>
            {advanced ? <BadgeRuleGuide /> : null}
            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCancel}
                >
                    {t('common.actions.cancel')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={!label}
                    onClick={() => onSave({ ...draft, label })}
                >
                    {t('common.actions.save')}
                </Button>
            </div>
        </div>
    );
}

export function useFriendGroupLabels(): (groupKey: string) => string {
    const friendGroups = useFavoriteStore(
        useShallow((state) => ({
            favoriteFriendGroups: state.favoriteFriendGroups,
            localFriendFavoriteGroups: state.localFriendFavoriteGroups
        }))
    );
    return useMemo(() => {
        const labels = new Map(
            buildFeedFavoriteGroupOptions(friendGroups).map((option) => [
                option.key,
                option.label
            ])
        );
        return (groupKey: string) => labels.get(groupKey) ?? groupKey;
    }, [friendGroups]);
}
