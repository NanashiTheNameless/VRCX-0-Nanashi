import { PlusIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { CustomBadgeChip } from '@/components/UserBadges';
import {
    CUSTOM_BADGE_GROUP_MEMBER_LIMIT,
    CUSTOM_BADGE_LABEL_MAX,
    CUSTOM_BADGE_MEMO_MAX,
    DEFAULT_CUSTOM_BADGE_COLOR,
    DEFAULT_CUSTOM_BADGE_ICON,
    createCustomBadgeId,
    extractBadgeUserIds,
    isGroupMemberListTruncated,
    normalizeBadgeColor,
    type CustomBadge,
    type CustomBadgeRule,
    type CustomBadgeRuleKind,
    isReservedBadgeIcon
} from '@/domain/badges/customBadges';
import type { GroupRoleRecord } from '@/domain/entities/group';
import { buildFeedFavoriteGroupOptions } from '@/domain/feed/feedFavoriteGroups';
import { formatDateFilter } from '@/lib/dateTime';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { toast } from '@/services/toastService';
import { TRUST_COLOR_ENTRIES } from '@/shared/constants/trustColors';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

import { BadgeIconPicker } from './BadgeIconPicker';

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
    'friends',
    'friendGroup',
    'vrchatGroup',
    'trust',
    'supporter',
    'memo',
    'bio'
];

function newRule(kind: CustomBadgeRuleKind): CustomBadgeRule {
    switch (kind) {
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
        case 'memo':
        case 'bio':
            return { kind, contains: '' };
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

function RuleEditor({
    rule,
    onChange,
    onRemove
}: {
    rule: CustomBadgeRule;
    onChange: (rule: CustomBadgeRule) => void;
    onRemove: () => void;
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

    let body = null;
    switch (rule.kind) {
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
                    <SelectTrigger className="w-64">
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
                    <SelectTrigger className="w-56">
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
        case 'memo':
        case 'bio':
            body = (
                <Input
                    className="w-64"
                    maxLength={CUSTOM_BADGE_MEMO_MAX}
                    value={rule.contains}
                    placeholder={t(`${T}.memo_placeholder`)}
                    aria-label={t(`${T}.rule.${rule.kind}`)}
                    onChange={(event) =>
                        onChange({ ...rule, contains: event.target.value })
                    }
                />
            );
            break;
        case 'friends':
        case 'supporter':
            body = null;
            break;
    }

    return (
        <div className="flex flex-col gap-2 rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                    <span className="text-sm font-medium">
                        {t(`${T}.rule.${rule.kind}`)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                        {t(`${T}.rule_description.${rule.kind}`)}
                    </span>
                </div>
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
            {body}
        </div>
    );
}

let ruleKeyCounter = 0;

// Rules have no id of their own; the editor gives each one a key that stays
// with it, so removing a rule never hands its editor state to the next one.
function nextRuleKey(): string {
    ruleKeyCounter += 1;
    return `rule-${ruleKeyCounter}`;
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
    const [ruleKind, setRuleKind] = useState<CustomBadgeRuleKind>('users');
    const [ruleKeys, setRuleKeys] = useState(() =>
        initial.rules.map(() => nextRuleKey())
    );
    const label = draft.label.trim();

    function updateRule(index: number, rule: CustomBadgeRule) {
        setDraft((current) => ({
            ...current,
            rules: current.rules.map((entry, i) => (i === index ? rule : entry))
        }));
    }

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
            <div className="flex flex-col gap-2">
                {draft.rules.length ? (
                    draft.rules.map((rule, index) => (
                        <RuleEditor
                            key={ruleKeys[index]}
                            rule={rule}
                            onChange={(next) => updateRule(index, next)}
                            onRemove={() => {
                                setDraft((current) => ({
                                    ...current,
                                    rules: current.rules.filter(
                                        (_, i) => i !== index
                                    )
                                }));
                                setRuleKeys((current) =>
                                    current.filter((_, i) => i !== index)
                                );
                            }}
                        />
                    ))
                ) : (
                    <span className="text-muted-foreground text-sm">
                        {t(`${T}.no_rules`)}
                    </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={ruleKind}
                        onValueChange={(value) => {
                            const kind = RULE_KINDS.find(
                                (entry) => entry === value
                            );
                            if (kind) {
                                setRuleKind(kind);
                            }
                        }}
                    >
                        <SelectTrigger className="w-56">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {RULE_KINDS.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                    {t(`${T}.rule.${kind}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setDraft((current) => ({
                                ...current,
                                rules: [...current.rules, newRule(ruleKind)]
                            }));
                            setRuleKeys((current) => [
                                ...current,
                                nextRuleKey()
                            ]);
                        }}
                    >
                        <PlusIcon />
                        {t(`${T}.add_rule`)}
                    </Button>
                </div>
            </div>
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
