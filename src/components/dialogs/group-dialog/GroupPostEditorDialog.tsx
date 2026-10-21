import { Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
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
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';

import { GroupGalleryImageField } from './GroupGalleryImageField';
import { GroupListState } from './GroupListState';
import type { GroupPostForm } from './useGroupDialogPosts';

export function GroupPostEditorDialog({
    open,
    onOpenChange,
    form,
    onFormChange,
    group,
    submitting = false,
    onSubmit
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    form: GroupPostForm | null;
    onFormChange: Dispatch<SetStateAction<GroupPostForm | null>>;
    group: GroupProfileRecord;
    submitting?: boolean;
    onSubmit: (form: GroupPostForm) => void;
}) {
    const { t } = useTranslation();

    if (!form) {
        return null;
    }
    const roles = Array.isArray(group?.roles) ? group.roles : [];
    const roleIds = Array.isArray(form.roleIds) ? form.roleIds : [];
    const isEdit = form.mode === 'edit';
    function updateForm(patch: Partial<GroupPostForm>) {
        onFormChange((current) =>
            current ? { ...current, ...patch } : current
        );
    }

    function toggleRole(roleId: string, checked: boolean) {
        const nextRoleIds = checked
            ? Array.from(new Set([...roleIds, roleId]))
            : roleIds.filter((id) => id !== roleId);
        updateForm({ roleIds: nextRoleIds });
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? 'Edit group post' : 'Create group post'}
                    </DialogTitle>
                    <DialogDescription>
                        {group?.name || 'Group'}
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup className="gap-4">
                    <Field>
                        <FieldLabel htmlFor="group-post-title">
                            {t('dialog.group_post_edit.title')}
                        </FieldLabel>
                        <Input
                            id="group-post-title"
                            value={form.title}
                            onChange={(event) =>
                                updateForm({ title: event.target.value })
                            }
                            disabled={submitting}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="group-post-text">
                            {t('table.notification.message')}
                        </FieldLabel>
                        <Textarea
                            id="group-post-text"
                            rows={4}
                            value={form.text}
                            onChange={(event) =>
                                updateForm({ text: event.target.value })
                            }
                            disabled={submitting}
                            className="resize-none"
                        />
                    </Field>
                    {!isEdit ? (
                        <Field
                            orientation="horizontal"
                            data-disabled={submitting}
                        >
                            <Checkbox
                                id="group-post-send-notification"
                                checked={Boolean(form.sendNotification)}
                                disabled={submitting}
                                onCheckedChange={(checked) =>
                                    updateForm({
                                        sendNotification: checked === true
                                    })
                                }
                            />
                            <FieldLabel htmlFor="group-post-send-notification">
                                {t('dialog.shared_feed_filters.notification')}
                            </FieldLabel>
                        </Field>
                    ) : null}
                    <Field>
                        <FieldLabel>
                            {t('dialog.group.posts.visibility')}
                        </FieldLabel>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            value={form.visibility ? [form.visibility] : []}
                            onValueChange={(value) => {
                                const visibility = value[0];
                                if (
                                    visibility === 'group' ||
                                    visibility === 'public'
                                ) {
                                    updateForm({ visibility });
                                }
                            }}
                            disabled={submitting}
                        >
                            {['public', 'group'].map((visibility, index) => (
                                <Fragment key={visibility}>
                                    {index > 0 ? (
                                        <ToggleGroupSeparator />
                                    ) : null}
                                    <ToggleGroupItem value={visibility}>
                                        {visibility === 'public'
                                            ? 'Public'
                                            : 'Group'}
                                    </ToggleGroupItem>
                                </Fragment>
                            ))}
                        </ToggleGroup>
                    </Field>
                    {form.visibility === 'group' ? (
                        <Field>
                            <FieldLabel>
                                {t('dialog.group.info.roles')}
                            </FieldLabel>
                            {roles.length ? (
                                <FieldGroup
                                    data-slot="checkbox-group"
                                    className="grid max-h-48 gap-2 overflow-auto rounded-md border p-2 sm:grid-cols-2"
                                >
                                    {roles.map((role) => (
                                        <Field
                                            key={role.id || role.name}
                                            orientation="horizontal"
                                            data-disabled={
                                                submitting || !role.id
                                            }
                                        >
                                            <Checkbox
                                                id={`group-post-role-${role.id || role.name}`}
                                                checked={
                                                    role.id
                                                        ? roleIds.includes(
                                                              role.id
                                                          )
                                                        : false
                                                }
                                                disabled={
                                                    submitting || !role.id
                                                }
                                                onCheckedChange={(checked) => {
                                                    if (role.id) {
                                                        toggleRole(
                                                            role.id,
                                                            checked === true
                                                        );
                                                    }
                                                }}
                                            />
                                            <FieldLabel
                                                htmlFor={`group-post-role-${role.id || role.name}`}
                                                className="min-w-0 truncate"
                                            >
                                                {role.name || role.id}
                                            </FieldLabel>
                                        </Field>
                                    ))}
                                </FieldGroup>
                            ) : (
                                <GroupListState
                                    title={t('dialog.group.empty.no_roles')}
                                    description=""
                                    className="min-h-20 p-3"
                                />
                            )}
                        </Field>
                    ) : null}
                    <GroupGalleryImageField
                        id="group-post-image-id"
                        open={open}
                        imageId={form.imageId || ''}
                        disabled={submitting}
                        onChange={(imageId) => updateForm({ imageId })}
                    />
                </FieldGroup>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={submitting}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={submitting}
                        onClick={() => onSubmit(form)}
                    >
                        {isEdit ? 'Edit Post' : 'Create Post'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
