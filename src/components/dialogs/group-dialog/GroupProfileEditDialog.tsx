import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { GroupProfileUpdate } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Separator } from '@/ui/shadcn/separator';
import { Textarea } from '@/ui/shadcn/textarea';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import {
    ProfileLanguagesField,
    ProfileLinksField
} from '../ProfileDetailsFields';
import { useSpokenLanguageSelection } from '../useSpokenLanguageSelection';
import {
    GROUP_JOIN_STATES,
    groupProfileUpdateFromGroup,
    isGroupJoinState
} from './groupDialogUtils';

const NO_LANGUAGES: string[] = [];

export function GroupProfileEditDialog({
    open,
    onOpenChange,
    group,
    saving = false,
    onSave
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    group: GroupProfileRecord;
    saving?: boolean;
    onSave: (params: GroupProfileUpdate) => void;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() =>
        groupProfileUpdateFromGroup(group)
    );
    const languageSelection = useSpokenLanguageSelection(
        draft?.languages ?? NO_LANGUAGES
    );

    useEffect(() => {
        if (open) {
            setDraft(groupProfileUpdateFromGroup(group));
        }
    }, [open, group]);

    if (!draft) {
        return null;
    }

    const nameValid = draft.name.trim().length >= 3;
    const shortCodeValid = /^[A-Z0-9]{3,6}$/.test(draft.shortCode);

    function updateDraft(patch: Partial<GroupProfileUpdate>) {
        setDraft((current) => (current ? { ...current, ...patch } : current));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
            <DialogContent className="grid max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group.actions.edit_profile')}
                    </DialogTitle>
                    <DialogDescription>{group.name}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="-mx-1 min-h-0">
                    <FieldGroup className="gap-4 px-1 pb-3">
                        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                            <Field data-invalid={!nameValid || undefined}>
                                <FieldLabel htmlFor="group-profile-name">
                                    {t('dialog.group.info.name')}
                                </FieldLabel>
                                <Input
                                    id="group-profile-name"
                                    value={draft.name}
                                    disabled={saving}
                                    aria-invalid={!nameValid || undefined}
                                    onChange={(event) =>
                                        updateDraft({
                                            name: event.target.value
                                        })
                                    }
                                />
                            </Field>
                            <Field data-invalid={!shortCodeValid || undefined}>
                                <FieldLabel htmlFor="group-profile-short-code">
                                    {t('dialog.group.edit.short_code')}
                                </FieldLabel>
                                <InputGroup>
                                    <InputGroupInput
                                        id="group-profile-short-code"
                                        value={draft.shortCode}
                                        maxLength={6}
                                        disabled={saving}
                                        aria-invalid={
                                            !shortCodeValid || undefined
                                        }
                                        className="font-mono"
                                        onChange={(event) =>
                                            updateDraft({
                                                shortCode: event.target.value
                                                    .toUpperCase()
                                                    .replace(/[^A-Z0-9]/g, '')
                                            })
                                        }
                                    />
                                    {group.discriminator ? (
                                        <InputGroupAddon
                                            align="inline-end"
                                            className="font-mono"
                                        >
                                            .{group.discriminator}
                                        </InputGroupAddon>
                                    ) : null}
                                </InputGroup>
                            </Field>
                        </div>
                        <FieldDescription className="-mt-2 text-xs">
                            {t('dialog.group.edit.short_code_hint')}
                        </FieldDescription>
                        <Field>
                            <FieldLabel htmlFor="group-profile-description">
                                {t('dialog.group.overview.description')}
                            </FieldLabel>
                            <Textarea
                                id="group-profile-description"
                                rows={4}
                                value={draft.description}
                                disabled={saving}
                                className="field-sizing-fixed max-h-48 min-h-24 resize-y overflow-y-auto"
                                onChange={(event) =>
                                    updateDraft({
                                        description: event.target.value
                                    })
                                }
                            />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="group-profile-rules">
                                {t('dialog.group.info.rules')}
                            </FieldLabel>
                            <Textarea
                                id="group-profile-rules"
                                rows={4}
                                value={draft.rules}
                                disabled={saving}
                                className="field-sizing-fixed max-h-48 min-h-24 resize-y overflow-y-auto"
                                onChange={(event) =>
                                    updateDraft({ rules: event.target.value })
                                }
                            />
                        </Field>
                        <Separator className="-my-1" />
                        <ProfileLanguagesField
                            languageRows={languageSelection.languageRows}
                            availableLanguageOptions={
                                languageSelection.availableLanguageOptions
                            }
                            languageOptionsStatus={
                                languageSelection.languageOptionsStatus
                            }
                            busy={saving}
                            onChange={(languages) => updateDraft({ languages })}
                        />
                        <ProfileLinksField
                            label={t('dialog.group.info.links')}
                            addLabel={t('dialog.group.edit.add_link')}
                            removeLabel={t('dialog.group.edit.remove_link')}
                            links={draft.links}
                            busy={saving}
                            onChange={(links) => updateDraft({ links })}
                        />
                        <Separator className="-my-1" />
                        <Field>
                            <FieldLabel>
                                {t('dialog.group.action.join_state')}
                            </FieldLabel>
                            <ToggleGroup
                                variant="outline"
                                size="sm"
                                value={[draft.joinState]}
                                disabled={saving}
                                onValueChange={(value) => {
                                    const joinState = value[0];
                                    if (isGroupJoinState(joinState)) {
                                        updateDraft({ joinState });
                                    }
                                }}
                            >
                                {GROUP_JOIN_STATES.map((joinState, index) => (
                                    <Fragment key={joinState}>
                                        {index > 0 ? (
                                            <ToggleGroupSeparator />
                                        ) : null}
                                        <ToggleGroupItem value={joinState}>
                                            {t(
                                                `dialog.group.edit.join_state_${joinState}`
                                            )}
                                        </ToggleGroupItem>
                                    </Fragment>
                                ))}
                            </ToggleGroup>
                        </Field>
                        <Field
                            orientation="horizontal"
                            data-disabled={saving || draft.joinState !== 'open'}
                        >
                            <Checkbox
                                id="group-profile-join-prompt"
                                checked={draft.allowGroupJoinPrompt}
                                disabled={saving || draft.joinState !== 'open'}
                                onCheckedChange={(checked) =>
                                    updateDraft({
                                        allowGroupJoinPrompt: checked === true
                                    })
                                }
                            />
                            <FieldLabel htmlFor="group-profile-join-prompt">
                                {t('dialog.group.edit.allow_join_prompt')}
                            </FieldLabel>
                        </Field>
                    </FieldGroup>
                </ScrollArea>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={saving || !nameValid || !shortCodeValid}
                        onClick={() =>
                            onSave({
                                ...draft,
                                name: draft.name.trim(),
                                description: draft.description.trim(),
                                rules: draft.rules.trim(),
                                links: draft.links
                                    .map((link) => link.trim())
                                    .filter(Boolean)
                            })
                        }
                    >
                        {t('common.actions.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
