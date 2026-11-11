import {
    InfoIcon,
    LinkIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    CONSENT_BOOP_BACK_KEY,
    CONSENT_EMOJI_KEY,
    CONSENT_HOURS_KEY,
    CONSENT_STATE_KEY,
    DEFAULT_CONSENT_HOURS,
    FOLLOW_LINK_RULES_KEY,
    isConsentEmoji,
    newFollowLinkRule,
    parseFollowLinkRules,
    pickConsentEmoji,
    ruleHasRequirement,
    type AgeRequirement,
    type FollowLinkRule
} from '@/domain/presence/followParty';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import configRepository from '@/repositories/configRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { buildFollowLinkUrl } from '@/services/remoteSyncWebsiteService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldLegend,
    FieldSet
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { CompactCheckList } from '../presence-automation/AutomationRuleLayout';
import { useJoinedGroupOptions } from '../presence-automation/useJoinedGroupOptions';
import { ConsentEmojiBadge, useJsonConfigValue } from './followPartyShared';
import { LiveLinksSection } from './LiveLinksSection';

const I18N = 'view.tools.follow_party';

type DialogOpenProps = {
    onOpenChange: (open: boolean) => void;
    open: boolean;
};

const AGE_OPTIONS: AgeRequirement[] = ['none', 'verified', 'adult'];

export function FollowLinksDialog({ open, onOpenChange }: DialogOpenProps) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserName = useRuntimeStore(
        (state) => state.auth.currentUserDisplayName
    );
    const groupOptions = useJoinedGroupOptions(open);
    const rules = useJsonConfigValue(
        FOLLOW_LINK_RULES_KEY,
        open,
        '[]',
        parseFollowLinkRules
    );
    const [consentEmoji, setConsentEmoji] = useState('');
    const [boopBack, setBoopBack] = useState(false);
    const [consentHours, setConsentHours] = useState(DEFAULT_CONSENT_HOURS);

    useEffect(() => {
        if (!open) {
            return;
        }
        let active = true;
        Promise.all([
            configRepository.getString(CONSENT_EMOJI_KEY, ''),
            configRepository.getBool(CONSENT_BOOP_BACK_KEY, false),
            configRepository.getInt(CONSENT_HOURS_KEY, DEFAULT_CONSENT_HOURS)
        ])
            .then(async ([emoji, boop, hours]) => {
                if (!active) {
                    return;
                }
                let nextEmoji = emoji;
                if (!isConsentEmoji(nextEmoji)) {
                    nextEmoji = pickConsentEmoji();
                    await configRepository.setString(
                        CONSENT_EMOJI_KEY,
                        nextEmoji
                    );
                }
                setConsentEmoji(nextEmoji);
                setBoopBack(boop === true);
                setConsentHours(Number(hours) || DEFAULT_CONSENT_HOURS);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [open]);

    function updateRule(id: string, change: Partial<FollowLinkRule>) {
        void rules.save(
            rules.value.map((rule) =>
                rule.id === id ? { ...rule, ...change } : rule
            )
        );
    }

    async function rotateEmoji() {
        const next = pickConsentEmoji(consentEmoji);
        setConsentEmoji(next);
        await configRepository.setString(CONSENT_EMOJI_KEY, next);
        toast.add({ type: 'success', title: t(`${I18N}.emoji_rotated`) });
    }

    async function clearOptIns() {
        await configRepository.setString(CONSENT_STATE_KEY, '{}');
        toast.add({ type: 'success', title: t(`${I18N}.opt_ins_cleared`) });
    }

    async function copyLink() {
        if (!currentUserId) {
            return;
        }
        try {
            const url = await buildFollowLinkUrl({
                userId: currentUserId,
                displayName: currentUserName,
                rules: rules.value.filter(ruleHasRequirement),
                consentEmoji
            });
            await copyTextToClipboard(url, {
                successMessage: t(`${I18N}.link_copied`),
                errorMessage: t(`${I18N}.link_copy_failed`)
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(`${I18N}.link_copy_failed`)
                )
            });
        }
    }

    const activeRules = rules.value.filter(
        (rule) => rule.enabled && ruleHasRequirement(rule)
    );
    const disabled = rules.loading;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[85vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>{t(`${I18N}.follow_links`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${I18N}.follow_links_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <FieldGroup className="gap-4 px-4 pb-4">
                        <FieldSet className="bg-card/40 rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <FieldLegend variant="label">
                                        {t(`${I18N}.share_link`)}
                                    </FieldLegend>
                                    <FieldDescription>
                                        {t(`${I18N}.share_link_description`)}
                                    </FieldDescription>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        disabled ||
                                        !currentUserId ||
                                        activeRules.length === 0
                                    }
                                    onClick={() => void copyLink()}
                                >
                                    <LinkIcon data-icon="inline-start" />
                                    {t(`${I18N}.copy_link`)}
                                </Button>
                            </div>
                            {activeRules.length === 0 ? (
                                <FieldDescription>
                                    {t(`${I18N}.no_active_rules`)}
                                </FieldDescription>
                            ) : null}
                        </FieldSet>

                        <LiveLinksSection open={open} />

                        {rules.value.map((rule) => (
                            <FieldSet
                                key={rule.id}
                                className="bg-card/40 rounded-lg border p-3"
                                disabled={disabled}
                            >
                                <div className="flex items-center gap-3">
                                    <Input
                                        value={rule.label}
                                        maxLength={60}
                                        placeholder={t(`${I18N}.rule_name`)}
                                        aria-label={t(`${I18N}.rule_name`)}
                                        onChange={(event) =>
                                            updateRule(rule.id, {
                                                label: event.target.value
                                            })
                                        }
                                    />
                                    <Switch
                                        checked={rule.enabled}
                                        aria-label={t(`${I18N}.rule_enabled`)}
                                        onCheckedChange={(checked) =>
                                            updateRule(rule.id, {
                                                enabled: checked
                                            })
                                        }
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t(`${I18N}.delete_rule`)}
                                        onClick={() =>
                                            void rules.save(
                                                rules.value.filter(
                                                    (other) =>
                                                        other.id !== rule.id
                                                )
                                            )
                                        }
                                    >
                                        <Trash2Icon />
                                    </Button>
                                </div>
                                <Field orientation="horizontal">
                                    <FieldLabel>
                                        {t(`${I18N}.require_friend`)}
                                    </FieldLabel>
                                    <Switch
                                        checked={rule.requireFriend}
                                        onCheckedChange={(checked) =>
                                            updateRule(rule.id, {
                                                requireFriend: checked
                                            })
                                        }
                                    />
                                </Field>
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N}.age_requirement`)}
                                    </FieldLabel>
                                    <Select
                                        value={rule.age}
                                        items={AGE_OPTIONS.map((age) => ({
                                            value: age,
                                            label: t(`${I18N}.age_${age}`)
                                        }))}
                                        onValueChange={(value) =>
                                            updateRule(rule.id, {
                                                age:
                                                    (value as AgeRequirement) ??
                                                    'none'
                                            })
                                        }
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {AGE_OPTIONS.map((age) => (
                                                    <SelectItem
                                                        key={age}
                                                        value={age}
                                                    >
                                                        {t(
                                                            `${I18N}.age_${age}`
                                                        )}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                    <FieldDescription>
                                        {t(
                                            `${I18N}.age_requirement_description`
                                        )}
                                    </FieldDescription>
                                </Field>
                                <Field>
                                    <FieldLabel>
                                        {t(`${I18N}.groups`)}
                                    </FieldLabel>
                                    <CompactCheckList
                                        values={rule.groups}
                                        options={groupOptions}
                                        onChange={(groups) =>
                                            updateRule(rule.id, {
                                                groups: groups.slice(0, 8)
                                            })
                                        }
                                    />
                                    <FieldDescription>
                                        {t(`${I18N}.groups_description`)}
                                    </FieldDescription>
                                </Field>
                                {!ruleHasRequirement(rule) ? (
                                    <FieldDescription className="text-destructive">
                                        {t(`${I18N}.rule_needs_requirement`)}
                                    </FieldDescription>
                                ) : null}
                            </FieldSet>
                        ))}
                        <Button
                            type="button"
                            variant="outline"
                            disabled={disabled || rules.value.length >= 16}
                            onClick={() =>
                                void rules.save([
                                    ...rules.value,
                                    newFollowLinkRule()
                                ])
                            }
                        >
                            <PlusIcon data-icon="inline-start" />
                            {t(`${I18N}.add_rule`)}
                        </Button>

                        <FieldSet className="bg-card/40 rounded-lg border p-3">
                            <FieldLegend variant="label">
                                {t(`${I18N}.boop_consent`)}
                            </FieldLegend>
                            <FieldDescription>
                                {t(`${I18N}.boop_consent_description`)}
                            </FieldDescription>
                            <div className="flex flex-wrap items-center gap-3">
                                {consentEmoji ? (
                                    <ConsentEmojiBadge emojiId={consentEmoji} />
                                ) : null}
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void rotateEmoji()}
                                >
                                    <RefreshCwIcon data-icon="inline-start" />
                                    {t(`${I18N}.rotate_emoji`)}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void clearOptIns()}
                                >
                                    {t(`${I18N}.clear_opt_ins`)}
                                </Button>
                            </div>
                            <Field orientation="horizontal">
                                <FieldLabel>
                                    {t(`${I18N}.boop_back`)}
                                </FieldLabel>
                                <Switch
                                    checked={boopBack}
                                    onCheckedChange={(checked) => {
                                        setBoopBack(checked);
                                        void configRepository.setBool(
                                            CONSENT_BOOP_BACK_KEY,
                                            checked
                                        );
                                    }}
                                />
                            </Field>
                            <Field>
                                <FieldLabel>
                                    {t(`${I18N}.consent_hours`)}
                                </FieldLabel>
                                <Input
                                    type="number"
                                    min={1}
                                    max={168}
                                    value={consentHours}
                                    onChange={(event) => {
                                        const hours = Math.min(
                                            168,
                                            Math.max(
                                                1,
                                                Number.parseInt(
                                                    event.target.value,
                                                    10
                                                ) || DEFAULT_CONSENT_HOURS
                                            )
                                        );
                                        setConsentHours(hours);
                                        void configRepository.setInt(
                                            CONSENT_HOURS_KEY,
                                            hours
                                        );
                                    }}
                                />
                                <FieldDescription>
                                    {t(`${I18N}.consent_hours_description`)}
                                </FieldDescription>
                            </Field>
                        </FieldSet>

                        <Alert>
                            <InfoIcon data-icon="inline-start" />
                            <AlertDescription>
                                {t(`${I18N}.limits_note`)}
                            </AlertDescription>
                        </Alert>
                    </FieldGroup>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}
