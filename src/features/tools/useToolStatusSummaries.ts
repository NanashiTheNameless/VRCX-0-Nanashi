import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    contextPresetLabelKeyFromValue,
    daysSummary,
    getTimeWindow,
    normalizeContextRule,
    normalizeTimeRule,
    ruleTitle
} from '@/components/hosts/tools-dialogs/presence-automation/presenceAutomationDialogUtils';
import {
    FOLLOW_LINK_RULES_KEY,
    PARTY_GROUPS_KEY,
    parseFollowLinkRules,
    parsePartyGroups,
    ruleHasRequirement
} from '@/domain/presence/followParty';
import { formatDateTime } from '@/lib/dateTime';
import {
    commands,
    type PresenceAutomationRuleKind
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    getCurrentAppLauncherSnapshot,
    setAppLauncherEntryEnabled
} from '@/services/appLauncherSnapshotService';
import { confirmDisablingBackupWithRecorder } from '@/services/offlineRecordService';
import {
    getProfileBackupSettings,
    setProfileBackupSettings
} from '@/services/profileBackupService';
import {
    publishToolsStatusUpdated,
    TOOLS_STATUS_UPDATED_EVENT
} from '@/shared/constants/tools';
import { isRecord } from '@/shared/utils/record';
import { useInventoryBundleStore } from '@/state/inventoryBundleStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';

type ToolStatusItem = {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    setEnabled: (enabled: boolean) => Promise<void>;
};

export type ToolStatusSummary = {
    label: string;
    tone: 'active' | 'neutral' | 'warning';
    toggle?: {
        enabled: boolean;
        setEnabled: (enabled: boolean) => Promise<void>;
    };
    items?: ToolStatusItem[];
};

const presenceRuleConfigKeys: Record<PresenceAutomationRuleKind, string> = {
    time: 'presenceAutomationTimeRules',
    context: 'presenceAutomationContextRules'
};

async function setPresenceRuleEnabled(
    kind: PresenceAutomationRuleKind,
    ruleId: string,
    enabled: boolean
) {
    const savedRules = await commands.appPresenceAutomationRuleEnabledSet(
        kind,
        ruleId,
        enabled
    );
    configRepository.applyServerEntry(
        presenceRuleConfigKeys[kind],
        JSON.stringify(savedRules)
    );
    publishToolsStatusUpdated();
}

function timeRuleItems(
    rules: readonly unknown[] | null,
    t: TFunction
): ToolStatusItem[] {
    return (rules ?? [])
        .filter(isRecord)
        .map(normalizeTimeRule)
        .map((rule) => {
            const timeWindow = getTimeWindow(rule);
            return {
                id: rule.id,
                label: ruleTitle(
                    rule,
                    t,
                    'view.tools.social_automation.schedule_rule_default'
                ),
                description: `${timeWindow.start} - ${timeWindow.end} / ${daysSummary(
                    timeWindow.days,
                    t
                )}`,
                enabled: rule.enabled !== false,
                setEnabled: (enabled) =>
                    setPresenceRuleEnabled('time', rule.id, enabled)
            };
        });
}

function contextRuleItems(
    rules: readonly unknown[] | null,
    t: TFunction
): ToolStatusItem[] {
    return (rules ?? [])
        .filter(isRecord)
        .map(normalizeContextRule)
        .map((rule) => ({
            id: rule.id,
            label: ruleTitle(
                rule,
                t,
                'view.tools.social_automation.room_rule_default'
            ),
            description: t(contextPresetLabelKeyFromValue(rule.preset)),
            enabled: rule.enabled !== false,
            setEnabled: (enabled) =>
                setPresenceRuleEnabled('context', rule.id, enabled)
        }));
}

function parseJson(raw: string | null): unknown {
    try {
        return raw === null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Fork: follow link rules and live location links, each with its own switch. */
async function followLinkStatus(
    t: TFunction
): Promise<ToolStatusSummary | null> {
    const [rawRules, shares] = await Promise.all([
        configRepository
            .getString(FOLLOW_LINK_RULES_KEY, '[]')
            .catch(() => null),
        commands.appFollowShareList().catch(() => null)
    ]);
    const rules = parseFollowLinkRules(parseJson(rawRules));
    const liveShares = (shares ?? []).filter((share) => !share.expired);
    if (!rules.length && !liveShares.length) {
        return null;
    }
    const setRuleEnabled = async (id: string, enabled: boolean) => {
        const next = rules.map((rule) =>
            rule.id === id ? { ...rule, enabled } : rule
        );
        await configRepository.setString(
            FOLLOW_LINK_RULES_KEY,
            JSON.stringify(next)
        );
        publishToolsStatusUpdated();
    };
    const items: ToolStatusItem[] = [
        ...rules.map((rule) => ({
            id: rule.id,
            label: rule.label || t('view.tools.follow_party.rule_default'),
            description: ruleHasRequirement(rule)
                ? t('view.tools.follow_party.status_rule')
                : t('view.tools.follow_party.rule_needs_requirement'),
            enabled: rule.enabled,
            setEnabled: (enabled: boolean) => setRuleEnabled(rule.id, enabled)
        })),
        ...liveShares.map((share) => ({
            id: `live:${share.id}`,
            label: share.label || share.code,
            description:
                share.mode === 'password'
                    ? t('view.tools.follow_party.status_live_password')
                    : t('view.tools.follow_party.status_live_public'),
            enabled: share.enabled,
            setEnabled: async (enabled: boolean) => {
                await commands.appFollowShareSetEnabled(share.id, enabled);
                publishToolsStatusUpdated();
            }
        }))
    ];
    const active = items.filter((item) => item.enabled).length;
    return {
        label: t('view.tools.follow_party.status_on_of_total', {
            enabled: active,
            total: items.length
        }),
        tone: active > 0 ? 'active' : 'neutral',
        items
    };
}

/** Fork: parties, each with its own switch. */
async function partyStatus(t: TFunction): Promise<ToolStatusSummary | null> {
    const raw = await configRepository
        .getString(PARTY_GROUPS_KEY, '[]')
        .catch(() => null);
    const parties = parsePartyGroups(parseJson(raw));
    if (!parties.length) {
        return null;
    }
    const active = parties.filter((party) => party.enabled).length;
    return {
        label: t('view.tools.follow_party.status_on_of_total', {
            enabled: active,
            total: parties.length
        }),
        tone: active > 0 ? 'active' : 'neutral',
        items: parties.map((party) => ({
            id: party.id,
            label: party.name || t('view.tools.follow_party.unnamed_party'),
            description: t('view.tools.follow_party.status_party_members', {
                count: party.members.length
            }),
            enabled: party.enabled,
            setEnabled: async (enabled: boolean) => {
                // Reread so a change made in the dialog meanwhile is kept.
                const current = parsePartyGroups(
                    parseJson(
                        await configRepository.getString(PARTY_GROUPS_KEY, '[]')
                    )
                );
                await configRepository.setString(
                    PARTY_GROUPS_KEY,
                    JSON.stringify(
                        current.map((other) =>
                            other.id === party.id
                                ? { ...other, enabled }
                                : other
                        )
                    )
                );
                publishToolsStatusUpdated();
            }
        }))
    };
}

export function countPresenceRules(rules: readonly unknown[] | null): {
    enabled: number;
    total: number;
} {
    const configuredRules = (rules ?? []).filter(isRecord);
    return {
        enabled: configuredRules.filter((rule) => rule.enabled !== false)
            .length,
        total: configuredRules.length
    };
}

async function loadToolStatusSummaries(
    t: TFunction
): Promise<Map<string, ToolStatusSummary>> {
    const [
        timeRules,
        contextRules,
        inviteMode,
        endpoints,
        appLauncher,
        backupSettings,
        followLinks,
        party
    ] = await Promise.all([
        commands.appPresenceAutomationRulesGet('time').catch(() => null),
        commands.appPresenceAutomationRulesGet('context').catch(() => null),
        configRepository
            .getString('autoAcceptInviteRequests', 'Off')
            .catch(() => null),
        commands.appLlmEndpointList().catch(() => null),
        getCurrentAppLauncherSnapshot().catch(() => null),
        getProfileBackupSettings().catch(() => null),
        followLinkStatus(t).catch(() => null),
        partyStatus(t).catch(() => null)
    ]);

    const next = new Map<string, ToolStatusSummary>();
    for (const [toolKey, rules, items] of [
        ['presence-schedule', timeRules, timeRuleItems(timeRules, t)],
        ['presence-room-rules', contextRules, contextRuleItems(contextRules, t)]
    ] as const) {
        const counts = countPresenceRules(rules);
        if (counts.enabled > 0) {
            next.set(toolKey, {
                label:
                    counts.enabled === counts.total
                        ? t('view.tools.status.rules_enabled', {
                              count: counts.enabled
                          })
                        : t('view.tools.status.rules_enabled_of_total', {
                              enabled: counts.enabled,
                              total: counts.total
                          }),
                tone: 'active',
                items
            });
        } else if (counts.total > 0) {
            next.set(toolKey, {
                label: t('view.tools.status.rules_configured_off', {
                    count: counts.total
                }),
                tone: 'neutral',
                items
            });
        }
    }

    if (inviteMode !== null) {
        const enabled = inviteMode !== 'Off';
        next.set('presence-invite-requests', {
            label: '',
            tone: enabled ? 'active' : 'neutral',
            toggle: {
                enabled,
                setEnabled: async (nextEnabled) => {
                    await configRepository.setString(
                        'autoAcceptInviteRequests',
                        nextEnabled ? 'All Favorites' : 'Off'
                    );
                    publishToolsStatusUpdated();
                }
            }
        });
    }

    if (appLauncher?.entries.length) {
        const entries = appLauncher.entries;
        next.set('app-launcher', {
            label: t('view.tools.status.apps_count', {
                count: entries.length
            }),
            tone: appLauncher.enabled ? 'active' : 'neutral',
            toggle: {
                enabled: appLauncher.enabled,
                setEnabled: async (nextEnabled) => {
                    await commands.appAppLauncherEnabledSet(nextEnabled);
                    publishToolsStatusUpdated();
                }
            },
            items: entries.map((entry) => ({
                id: entry.id,
                label: entry.name,
                description: t(`dialog.app_launcher.scope_${entry.scope}`),
                enabled: entry.enabled,
                setEnabled: async (enabled) => {
                    await setAppLauncherEntryEnabled(entry.id, enabled);
                    publishToolsStatusUpdated();
                }
            }))
        });
    }

    if (backupSettings?.autoTargetDir) {
        next.set('profile-backup', {
            label: backupSettings.lastAutoAt
                ? t('view.tools.status.last_backup', {
                      date: formatDateTime(backupSettings.lastAutoAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                      })
                  })
                : t('view.tools.status.automatic_backup'),
            tone: backupSettings.autoEnabled ? 'active' : 'neutral',
            toggle: {
                enabled: backupSettings.autoEnabled,
                setEnabled: async (nextEnabled) => {
                    if (
                        !nextEnabled &&
                        !(await confirmDisablingBackupWithRecorder())
                    ) {
                        return;
                    }
                    await setProfileBackupSettings({
                        ...backupSettings,
                        autoEnabled: nextEnabled
                    });
                    publishToolsStatusUpdated();
                }
            }
        });
    }

    if (followLinks) {
        next.set('follow-links', followLinks);
    }
    if (party) {
        next.set('party', party);
    }

    if (endpoints?.length) {
        next.set('llm-endpoints', {
            label: t('view.tools.status.connections_configured', {
                count: endpoints.length
            }),
            tone: 'neutral'
        });
    }

    return next;
}

export function useToolStatusSummaries(): Map<string, ToolStatusSummary> {
    const { t } = useTranslation();
    const backupOutcomeRevision = useProfileBackupStore(
        (state) => state.status.lastOutcome?.revision ?? -1
    );
    const unopenedBundleCount = useInventoryBundleStore(
        (state) => state.bundleIds.length
    );
    const [statusByToolKey, setStatusByToolKey] = useState(
        () => new Map<string, ToolStatusSummary>()
    );

    useEffect(() => {
        let active = true;
        let requestRevision = 0;
        const refresh = () => {
            const expectedRevision = ++requestRevision;
            void loadToolStatusSummaries(t).then((next) => {
                if (active && expectedRevision === requestRevision) {
                    setStatusByToolKey(next);
                }
            });
        };
        refresh();
        window.addEventListener(TOOLS_STATUS_UPDATED_EVENT, refresh);
        return () => {
            active = false;
            window.removeEventListener(TOOLS_STATUS_UPDATED_EVENT, refresh);
        };
    }, [backupOutcomeRevision, t]);

    return useMemo(() => {
        if (unopenedBundleCount === 0) {
            return statusByToolKey;
        }
        return new Map(statusByToolKey).set('inventory', {
            label: t('view.tools.status.unopened_bundles', {
                count: unopenedBundleCount
            }),
            tone: 'active'
        });
    }, [statusByToolKey, t, unopenedBundleCount]);
}
