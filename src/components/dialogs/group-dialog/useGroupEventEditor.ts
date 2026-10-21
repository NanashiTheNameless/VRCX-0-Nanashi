import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { commands } from '@/platform/tauri/bindings';
import { unwrapVrchatResponse } from '@/repositories/vrchatRequest';
import type { GroupCalendarEventRecord } from '@/repositories/vrchatToolsRepository';
import { toast } from '@/services/toastService';
import type { useModalStore } from '@/state/modalStore';

import {
    createGroupEventForm,
    groupEventFormFromEvent,
    groupEventMutation,
    type GroupEventForm
} from './groupEventForm';

type Confirm = ReturnType<typeof useModalStore.getState>['confirm'];

export function useGroupEventEditor({
    group,
    confirm,
    onChanged
}: {
    group: GroupProfileRecord;
    confirm: Confirm;
    onChanged: () => void;
}) {
    const { t } = useTranslation();
    const [form, setForm] = useState<GroupEventForm | null>(null);
    const [saving, setSaving] = useState(false);
    const groupId = group.id;

    useEffect(() => {
        setForm(null);
    }, [groupId]);

    function openCreate() {
        setForm(createGroupEventForm());
    }

    function openEdit(event: GroupCalendarEventRecord) {
        setForm(groupEventFormFromEvent(event));
    }

    function close() {
        if (!saving) {
            setForm(null);
        }
    }

    async function submit(nextForm: GroupEventForm) {
        if (!groupId || saving) {
            return;
        }
        setSaving(true);
        try {
            const event = groupEventMutation(nextForm);
            if (nextForm.mode === 'edit') {
                unwrapVrchatResponse(
                    await commands.appVrchatToolsGroupEventUpdate({
                        groupId,
                        eventId: nextForm.eventId,
                        event
                    }),
                    `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(nextForm.eventId)}/event`
                );
            } else {
                unwrapVrchatResponse(
                    await commands.appVrchatToolsGroupEventCreate({
                        groupId,
                        event
                    }),
                    `calendar/${encodeURIComponent(groupId)}/event`
                );
            }
            toast.add({
                type: 'success',
                title: t(
                    nextForm.mode === 'edit'
                        ? 'dialog.group_event_edit.edit_success'
                        : 'dialog.group_event_edit.create_success'
                )
            });
            setForm(null);
            onChanged();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.group_event_edit.save_error')
                )
            });
        } finally {
            setSaving(false);
        }
    }

    async function remove(eventId: string, title: string) {
        if (!groupId || !eventId || saving) {
            return;
        }
        const result = await confirm({
            title: t('dialog.group_event_edit.delete_confirm'),
            description: title,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setSaving(true);
        try {
            unwrapVrchatResponse(
                await commands.appVrchatToolsGroupEventDelete({
                    groupId,
                    eventId
                }),
                `calendar/${encodeURIComponent(groupId)}/${encodeURIComponent(eventId)}`
            );
            toast.add({
                type: 'success',
                title: t('dialog.group_event_edit.delete_success')
            });
            setForm(null);
            onChanged();
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.group_event_edit.delete_error')
                )
            });
        } finally {
            setSaving(false);
        }
    }

    return { close, form, openCreate, openEdit, remove, saving, submit };
}
