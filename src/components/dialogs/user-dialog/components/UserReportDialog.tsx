import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import vrchatToolsRepository from '@/repositories/vrchatToolsRepository';
import { toast } from '@/services/toastService';
import { useVrchatConfigStore } from '@/state/vrchatConfigStore';
import { Button } from '@/ui/shadcn/button';
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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

import { userReportCategories } from '../userReportOptions';

type UserReportDialogProps = {
    open: boolean;
    targetUserId: string;
    targetLabel?: string;
    onOpenChange: (open: boolean) => void;
};

export function UserReportDialog({
    open,
    targetUserId,
    targetLabel,
    onOpenChange
}: UserReportDialogProps) {
    const { t } = useTranslation();
    const config = useVrchatConfigStore((state) => state.snapshot);
    const categories = useMemo(() => userReportCategories(config), [config]);
    const [category, setCategory] = useState('');
    const [reason, setReason] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const selectedCategory = categories.find(
        (option) => option.value === category
    );
    const selectedReason = selectedCategory?.reasons.find(
        (option) => option.value === reason
    );

    useEffect(() => {
        if (open) {
            setCategory('');
            setReason('');
            setDescription('');
        }
    }, [open]);

    async function submit() {
        if (!targetUserId || !selectedCategory || !selectedReason) {
            return;
        }
        setSubmitting(true);
        try {
            await vrchatToolsRepository.reportUser({
                userId: targetUserId,
                category: selectedCategory.value,
                reason: selectedReason.value,
                description
            });
            toast.add({
                type: 'success',
                title: t('dialog.user.success.report_sent')
            });
            onOpenChange(false);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('dialog.user.toast.failed_to_report_user')
            });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!submitting) {
                    onOpenChange(nextOpen);
                }
            }}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('dialog.user.report.header')}</DialogTitle>
                    {targetLabel ? (
                        <DialogDescription>{targetLabel}</DialogDescription>
                    ) : null}
                </DialogHeader>
                {categories.length ? (
                    <FieldGroup>
                        <Field>
                            <FieldLabel>
                                {t('dialog.user.report.category')}
                            </FieldLabel>
                            <Select
                                value={category || null}
                                disabled={submitting}
                                items={categories.map((option) => ({
                                    value: option.value,
                                    label: option.label
                                }))}
                                onValueChange={(value) => {
                                    setCategory(value ?? '');
                                    setReason('');
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={t(
                                            'dialog.user.report.category'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {categories.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            {selectedCategory?.tooltip ? (
                                <FieldDescription>
                                    {selectedCategory.tooltip}
                                </FieldDescription>
                            ) : null}
                        </Field>
                        <Field data-disabled={!selectedCategory}>
                            <FieldLabel>
                                {t('dialog.user.report.reason')}
                            </FieldLabel>
                            <Select
                                value={reason || null}
                                disabled={submitting || !selectedCategory}
                                items={(selectedCategory?.reasons ?? []).map(
                                    (option) => ({
                                        value: option.value,
                                        label: option.label
                                    })
                                )}
                                onValueChange={(value) =>
                                    setReason(value ?? '')
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue
                                        placeholder={t(
                                            'dialog.user.report.reason'
                                        )}
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {(selectedCategory?.reasons ?? []).map(
                                            (option) => (
                                                <SelectItem
                                                    key={option.value}
                                                    value={option.value}
                                                >
                                                    {option.label}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            {selectedReason?.tooltip ? (
                                <FieldDescription>
                                    {selectedReason.tooltip}
                                </FieldDescription>
                            ) : null}
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="user-report-description">
                                {t('dialog.user.report.description')}
                            </FieldLabel>
                            <Textarea
                                id="user-report-description"
                                value={description}
                                disabled={submitting}
                                className="min-h-24 resize-y"
                                placeholder={t(
                                    'dialog.user.report.description_placeholder'
                                )}
                                onChange={(event) =>
                                    setDescription(event.target.value)
                                }
                            />
                        </Field>
                    </FieldGroup>
                ) : (
                    <p className="text-muted-foreground text-sm">
                        {t('dialog.user.report.no_options')}
                    </p>
                )}
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={submitting}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={
                            submitting || !selectedCategory || !selectedReason
                        }
                        onClick={() => void submit()}
                    >
                        {t('dialog.user.modal.report')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
