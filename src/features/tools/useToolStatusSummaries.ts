import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    contextPresetLabelKeyFromValue,
    daysSummary,
    getTimeWindow,
    normalizeContextRule,
    normalizeTimeRule,
    ruleTitle
} from '@/components/hosts/tools-dialogs/presence-automation/presenceAutomationDialogUtils';
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
import {
    getProfileBackupSettings,
    setProfileBackupSettings
} from '@/services/profileBackupService';
import {
    publishToolsStatusUpdated,
    TOOLS_STATUS_UPDATED_EVENT
} from '@/shared/constants/tools';
import { isRecord } from '@/shared/utils/record';
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
    tone: 'active' | 'neutral';
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
        backupSettings
    ] = await Promise.all([
        commands.appPresenceAutomationRulesGet('time').catch(() => null),
        commands.appPresenceAutomationRulesGet('context').catch(() => null),
        configRepository
            .getString('autoAcceptInviteRequests', 'Off')
            .catch(() => null),
        commands.appLlmEndpointList().catch(() => null),
        getCurrentAppLauncherSnapshot().catch(() => null),
        getProfileBackupSettings().catch(() => null)
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
                    await setProfileBackupSettings({
                        ...backupSettings,
                        autoEnabled: nextEnabled
                    });
                    publishToolsStatusUpdated();
                }
            }
        });
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

    return statusByToolKey;
}
