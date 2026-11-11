import {
    HeartHandshakeIcon,
    InfoIcon,
    LinkIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon,
    XIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    mergeJoinedParty,
    newPartyGroup,
    PARTY_GROUPS_KEY,
    parsePartyGroups,
    partyFromJoinOffer,
    pickConsentEmoji,
    type FollowMode,
    type PartyGroup,
    type PartyRole
} from '@/domain/presence/followParty';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { copyTextToClipboard } from '@/services/clipboardService';
import { sendBoopToUser } from '@/services/inviteDeliveryService';
import { buildPartyLinkUrl } from '@/services/remoteSyncWebsiteService';
import { toast } from '@/services/toastService';
import {
    defaultEmojiName,
    defaultEmojiPreviewUrl
} from '@/shared/constants/vrchatDefaultEmojis';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { usePartyJoinStore } from '@/state/partyJoinStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
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

import { FriendMultiSelect } from '../presence-automation/FriendMultiSelect';
import { ConsentEmojiBadge, useJsonConfigValue } from './followPartyShared';

const I18N = 'view.tools.follow_party';
const MAX_MEMBERS = 32;
/** Gap between confirmation boops, so a party of 32 never bursts. */
const CONFIRM_BOOP_GAP_MS = 1500;

type DialogOpenProps = {
    onOpenChange: (open: boolean) => void;
    open: boolean;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function PartyDialog({ open, onOpenChange }: DialogOpenProps) {
    const { t } = useTranslation();
    const currentUserId =
        useRuntimeStore((state) => state.auth.currentUserId) ?? '';
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const offer = usePartyJoinStore((state) => state.offer);
    const setOffer = usePartyJoinStore((state) => state.setOffer);
    const parties = useJsonConfigValue(
        PARTY_GROUPS_KEY,
        open,
        '[]',
        parsePartyGroups
    );
    const [confirming, setConfirming] = useState<string | null>(null);

    const nameOf = (userId: string, fallback = '') =>
        friendsById[userId]?.displayName || fallback || userId;

    function updateParty(id: string, change: Partial<PartyGroup>) {
        void parties.save(
            parties.value.map((party) =>
                party.id === id ? { ...party, ...change } : party
            )
        );
    }

    function setMembers(party: PartyGroup, memberIds: string[]) {
        const kept = party.members.filter((member) =>
            memberIds.includes(member.userId)
        );
        const added = memberIds
            .filter((userId) => userId !== currentUserId)
            .filter(
                (userId) => !kept.some((member) => member.userId === userId)
            )
            .map((userId) => ({
                userId,
                displayName: nameOf(userId),
                role: 'member' as PartyRole
            }));
        const members = [...kept, ...added].slice(0, MAX_MEMBERS);
        const leaderStillListed =
            party.leaderUserId === currentUserId ||
            members.some((member) => member.userId === party.leaderUserId);
        updateParty(party.id, {
            members,
            leaderUserId: leaderStillListed ? party.leaderUserId : ''
        });
    }

    async function joinOffer() {
        if (!offer || !currentUserId) {
            return;
        }
        const names = Object.fromEntries(
            offer.members.map((member) => [
                member.userId,
                nameOf(member.userId, '')
            ])
        );
        const joined = partyFromJoinOffer(offer, currentUserId, names);
        await parties.save(mergeJoinedParty(parties.value, joined));
        setOffer(null);
        toast.add({ type: 'success', title: t(`${I18N}.party_joined`) });
    }

    async function confirmMembers(party: PartyGroup) {
        const members = party.members.filter(
            (member) => member.role === 'member'
        );
        if (!members.length) {
            return;
        }
        setConfirming(party.id);
        let sent = 0;
        try {
            for (const [index, member] of members.entries()) {
                if (index > 0) {
                    await sleep(CONFIRM_BOOP_GAP_MS);
                }
                await sendBoopToUser({
                    userId: member.userId,
                    emoji: {
                        kind: 'default',
                        id: party.emoji,
                        imageUrl: defaultEmojiPreviewUrl(party.emoji),
                        name: defaultEmojiName(party.emoji)
                    }
                });
                sent += 1;
            }
            toast.add({
                type: 'success',
                title: t(`${I18N}.confirm_boops_sent`, { count: sent })
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t(`${I18N}.confirm_boops_failed`)
                )
            });
        } finally {
            setConfirming(null);
        }
    }

    async function copyPartyLink(party: PartyGroup) {
        try {
            const url = await buildPartyLinkUrl(party, currentUserId);
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

    const disabled = parties.loading;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[85vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="px-4 pt-4 pr-12 pb-3">
                    <DialogTitle>{t(`${I18N}.party`)}</DialogTitle>
                    <DialogDescription>
                        {t(`${I18N}.party_description`)}
                    </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                    <FieldGroup className="gap-4 px-4 pb-4">
                        {offer ? (
                            <Alert>
                                <HeartHandshakeIcon data-icon="inline-start" />
                                <AlertTitle>
                                    {t(`${I18N}.join_offer_title`, {
                                        name:
                                            offer.name ||
                                            t(`${I18N}.unnamed_party`)
                                    })}
                                </AlertTitle>
                                <AlertDescription>
                                    <div className="flex flex-col gap-2">
                                        <span>
                                            {t(
                                                `${I18N}.join_offer_description`
                                            )}
                                        </span>
                                        <ConsentEmojiBadge
                                            emojiId={offer.emoji}
                                        />
                                        <ul className="list-disc pl-5">
                                            {offer.members
                                                .filter(
                                                    (member) =>
                                                        member.userId !==
                                                        currentUserId
                                                )
                                                .map((member) => (
                                                    <li key={member.userId}>
                                                        {nameOf(member.userId)}{' '}
                                                        (
                                                        {t(
                                                            `${I18N}.role_${member.role === 'guest' ? 'guest' : 'member'}`
                                                        )}
                                                        )
                                                    </li>
                                                ))}
                                        </ul>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                disabled={
                                                    disabled || !currentUserId
                                                }
                                                onClick={() => void joinOffer()}
                                            >
                                                {t(`${I18N}.join_party`)}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setOffer(null)}
                                            >
                                                <XIcon data-icon="inline-start" />
                                                {t(`${I18N}.dismiss`)}
                                            </Button>
                                        </div>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        ) : null}

                        {parties.value.map((party) => {
                            const memberIds = party.members.map(
                                (member) => member.userId
                            );
                            const leaderOptions = [
                                currentUserId,
                                ...party.members
                                    .filter(
                                        (member) => member.role === 'member'
                                    )
                                    .map((member) => member.userId)
                            ].filter(Boolean);
                            return (
                                <FieldSet
                                    key={party.id}
                                    className="bg-card/40 rounded-lg border p-3"
                                    disabled={disabled}
                                >
                                    <div className="flex items-center gap-3">
                                        <Input
                                            value={party.name}
                                            maxLength={60}
                                            placeholder={t(
                                                `${I18N}.party_name`
                                            )}
                                            aria-label={t(`${I18N}.party_name`)}
                                            onChange={(event) =>
                                                updateParty(party.id, {
                                                    name: event.target.value
                                                })
                                            }
                                        />
                                        <Switch
                                            checked={party.enabled}
                                            aria-label={t(
                                                `${I18N}.party_enabled`
                                            )}
                                            onCheckedChange={(checked) =>
                                                updateParty(party.id, {
                                                    enabled: checked
                                                })
                                            }
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label={t(
                                                `${I18N}.delete_party`
                                            )}
                                            onClick={() =>
                                                void parties.save(
                                                    parties.value.filter(
                                                        (other) =>
                                                            other.id !==
                                                            party.id
                                                    )
                                                )
                                            }
                                        >
                                            <Trash2Icon />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <ConsentEmojiBadge
                                            emojiId={party.emoji}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                                updateParty(party.id, {
                                                    emoji: pickConsentEmoji(
                                                        party.emoji
                                                    )
                                                })
                                            }
                                        >
                                            <RefreshCwIcon data-icon="inline-start" />
                                            {t(`${I18N}.rotate_emoji`)}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={
                                                confirming !== null ||
                                                !party.members.some(
                                                    (member) =>
                                                        member.role === 'member'
                                                )
                                            }
                                            onClick={() =>
                                                void confirmMembers(party)
                                            }
                                        >
                                            <HeartHandshakeIcon data-icon="inline-start" />
                                            {confirming === party.id
                                                ? t(`${I18N}.confirming`)
                                                : t(`${I18N}.confirm_members`)}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={!currentUserId}
                                            onClick={() =>
                                                void copyPartyLink(party)
                                            }
                                        >
                                            <LinkIcon data-icon="inline-start" />
                                            {t(`${I18N}.copy_link`)}
                                        </Button>
                                    </div>
                                    <FieldDescription>
                                        {t(`${I18N}.party_emoji_description`)}
                                    </FieldDescription>
                                    <Field>
                                        <FieldLabel>
                                            {t(`${I18N}.members`)}
                                        </FieldLabel>
                                        <FriendMultiSelect
                                            values={memberIds}
                                            friendsById={friendsById}
                                            orderedFriendIds={orderedFriendIds}
                                            onChange={(next) =>
                                                setMembers(party, next)
                                            }
                                        />
                                        <ul className="flex flex-col gap-1">
                                            {party.members.map((member) => (
                                                <li
                                                    key={member.userId}
                                                    className="flex items-center justify-between gap-2"
                                                >
                                                    <span className="truncate">
                                                        {nameOf(
                                                            member.userId,
                                                            member.displayName
                                                        )}
                                                    </span>
                                                    <Select
                                                        value={member.role}
                                                        items={[
                                                            {
                                                                value: 'member',
                                                                label: t(
                                                                    `${I18N}.role_member`
                                                                )
                                                            },
                                                            {
                                                                value: 'guest',
                                                                label: t(
                                                                    `${I18N}.role_guest`
                                                                )
                                                            }
                                                        ]}
                                                        onValueChange={(
                                                            value
                                                        ) =>
                                                            updateParty(
                                                                party.id,
                                                                {
                                                                    members:
                                                                        party.members.map(
                                                                            (
                                                                                other
                                                                            ) =>
                                                                                other.userId ===
                                                                                member.userId
                                                                                    ? {
                                                                                          ...other,
                                                                                          role:
                                                                                              value ===
                                                                                              'guest'
                                                                                                  ? 'guest'
                                                                                                  : 'member'
                                                                                      }
                                                                                    : other
                                                                        )
                                                                }
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger className="w-32">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectGroup>
                                                                <SelectItem value="member">
                                                                    {t(
                                                                        `${I18N}.role_member`
                                                                    )}
                                                                </SelectItem>
                                                                <SelectItem value="guest">
                                                                    {t(
                                                                        `${I18N}.role_guest`
                                                                    )}
                                                                </SelectItem>
                                                            </SelectGroup>
                                                        </SelectContent>
                                                    </Select>
                                                </li>
                                            ))}
                                        </ul>
                                        <FieldDescription>
                                            {t(`${I18N}.roles_description`)}
                                        </FieldDescription>
                                    </Field>
                                    <Field>
                                        <FieldLabel>
                                            {t(`${I18N}.follow_mode`)}
                                        </FieldLabel>
                                        <Select
                                            value={party.followMode}
                                            items={[
                                                {
                                                    value: 'anyone',
                                                    label: t(
                                                        `${I18N}.follow_anyone`
                                                    )
                                                },
                                                {
                                                    value: 'leader',
                                                    label: t(
                                                        `${I18N}.follow_leader`
                                                    )
                                                }
                                            ]}
                                            onValueChange={(value) =>
                                                updateParty(party.id, {
                                                    followMode:
                                                        (value as FollowMode) ??
                                                        'anyone'
                                                })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value="anyone">
                                                        {t(
                                                            `${I18N}.follow_anyone`
                                                        )}
                                                    </SelectItem>
                                                    <SelectItem value="leader">
                                                        {t(
                                                            `${I18N}.follow_leader`
                                                        )}
                                                    </SelectItem>
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    {party.followMode === 'leader' ? (
                                        <Field>
                                            <FieldLabel>
                                                {t(`${I18N}.leader`)}
                                            </FieldLabel>
                                            <Select
                                                value={party.leaderUserId}
                                                items={leaderOptions.map(
                                                    (userId) => ({
                                                        value: userId,
                                                        label:
                                                            userId ===
                                                            currentUserId
                                                                ? t(
                                                                      `${I18N}.leader_me`
                                                                  )
                                                                : nameOf(userId)
                                                    })
                                                )}
                                                onValueChange={(value) =>
                                                    updateParty(party.id, {
                                                        leaderUserId:
                                                            value ?? ''
                                                    })
                                                }
                                            >
                                                <SelectTrigger>
                                                    <SelectValue
                                                        placeholder={t(
                                                            `${I18N}.choose_leader`
                                                        )}
                                                    />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {leaderOptions.map(
                                                            (userId) => (
                                                                <SelectItem
                                                                    key={userId}
                                                                    value={
                                                                        userId
                                                                    }
                                                                >
                                                                    {userId ===
                                                                    currentUserId
                                                                        ? t(
                                                                              `${I18N}.leader_me`
                                                                          )
                                                                        : nameOf(
                                                                              userId
                                                                          )}
                                                                </SelectItem>
                                                            )
                                                        )}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                    ) : null}
                                    <Field orientation="horizontal">
                                        <FieldLabel>
                                            {t(`${I18N}.auto_launch`)}
                                        </FieldLabel>
                                        <Switch
                                            checked={party.autoLaunch}
                                            onCheckedChange={(checked) =>
                                                updateParty(party.id, {
                                                    autoLaunch: checked
                                                })
                                            }
                                        />
                                    </Field>
                                    <FieldDescription>
                                        {t(`${I18N}.auto_launch_description`)}
                                    </FieldDescription>
                                </FieldSet>
                            );
                        })}
                        <Button
                            type="button"
                            variant="outline"
                            disabled={disabled || parties.value.length >= 16}
                            onClick={() =>
                                void parties.save([
                                    ...parties.value,
                                    newPartyGroup()
                                ])
                            }
                        >
                            <PlusIcon data-icon="inline-start" />
                            {t(`${I18N}.add_party`)}
                        </Button>
                        <FieldSet className="bg-card/40 rounded-lg border p-3">
                            <FieldLegend variant="label">
                                {t(`${I18N}.how_party_works`)}
                            </FieldLegend>
                            <FieldDescription>
                                {t(`${I18N}.how_party_works_description`)}
                            </FieldDescription>
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
