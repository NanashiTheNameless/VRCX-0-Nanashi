import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupGalleryImageField } from '@/components/dialogs/group-dialog/GroupGalleryImageField';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Spinner } from '@/ui/shadcn/spinner';
import { Textarea } from '@/ui/shadcn/textarea';

export function InstanceAnnouncementDialog({
    open,
    busy,
    onOpenChange,
    onSubmit
}: {
    open: boolean;
    busy: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (
        message: string,
        imageId: string,
        imageVersion: string
    ) => Promise<boolean>;
}) {
    const { t } = useTranslation();
    const [message, setMessage] = useState('');
    const [imageId, setImageId] = useState('');
    const [imageVersion, setImageVersion] = useState('');

    useEffect(() => {
        if (open) {
            setMessage('');
            setImageId('');
            setImageVersion('');
        }
    }, [open]);

    const canSend = !busy && message.trim().length > 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!busy) {
                    onOpenChange(next);
                }
            }}
        >
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('component.instance_action_bar.announcement.header')}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'component.instance_action_bar.announcement.description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <Field>
                        <FieldLabel htmlFor="instance-announcement-message">
                            {t(
                                'component.instance_action_bar.announcement.message'
                            )}
                        </FieldLabel>
                        <Textarea
                            id="instance-announcement-message"
                            rows={4}
                            value={message}
                            disabled={busy}
                            className="resize-none"
                            onChange={(event) => setMessage(event.target.value)}
                        />
                    </Field>
                    <GroupGalleryImageField
                        id="instance-announcement-image"
                        open={open}
                        imageId={imageId}
                        disabled={busy}
                        onChange={setImageId}
                        onVersionChange={setImageVersion}
                    />
                    <p className="text-muted-foreground text-xs">
                        {t(
                            'component.instance_action_bar.announcement.image_hint'
                        )}
                    </p>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('common.actions.cancel')}
                    </Button>
                    <Button
                        type="button"
                        disabled={!canSend}
                        onClick={() => {
                            void onSubmit(message, imageId, imageVersion).then(
                                (sent) => {
                                    if (sent) {
                                        onOpenChange(false);
                                    }
                                }
                            );
                        }}
                    >
                        {busy ? <Spinner data-icon="inline-start" /> : null}
                        {t('component.instance_action_bar.announcement.send')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
