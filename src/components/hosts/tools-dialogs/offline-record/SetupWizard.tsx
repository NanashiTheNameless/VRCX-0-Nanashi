import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { FeedLoggerSession } from '@/platform/tauri/bindings';
import { Button } from '@/ui/shadcn/button';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';

import {
    SETUP_STEPS,
    type RunAction,
    type SetupStep
} from './offlineRecordModel';
import { VrchatLoginForm } from './VrchatLoginForm';

function SetupProgress({ step }: { step: SetupStep }) {
    const { t } = useTranslation();
    const label = t('offline_record.setup.progress', {
        current: step,
        total: SETUP_STEPS
    });
    return (
        <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs">{label}</span>
            <div
                role="progressbar"
                aria-label={label}
                aria-valuemin={1}
                aria-valuemax={SETUP_STEPS}
                aria-valuenow={step}
                className="grid grid-cols-4 gap-1.5"
            >
                {Array.from({ length: SETUP_STEPS }, (_, index) => (
                    <span
                        key={index}
                        className={cn(
                            'h-1 rounded-full transition-colors',
                            index < step ? 'bg-primary' : 'bg-muted'
                        )}
                    />
                ))}
            </div>
        </div>
    );
}

function SetupStepFrame({
    title,
    description,
    children,
    actions
}: {
    title: string;
    description: string;
    children?: ReactNode;
    actions: ReactNode;
}) {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h3 className="text-base font-medium">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    {description}
                </p>
            </div>
            {children}
            <div className="flex justify-end gap-2">{actions}</div>
        </section>
    );
}

export function SetupWizard({
    step,
    busy,
    session,
    savedCredentialsAvailable,
    error,
    onOpenBackup,
    onConnect,
    onCancelSetup,
    run
}: {
    step: SetupStep;
    busy: boolean;
    session: FeedLoggerSession | null;
    savedCredentialsAvailable: boolean;
    error: string;
    onOpenBackup: () => void;
    onConnect: (address: string, password: string) => void;
    onCancelSetup: () => void;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const [address, setAddress] = useState('');
    const [password, setPassword] = useState('');
    const [enteringPassword, setEnteringPassword] = useState(false);
    const currentStep: SetupStep = step === 2 && enteringPassword ? 3 : step;

    return (
        <div className="flex flex-col gap-5">
            <SetupProgress step={currentStep} />
            {currentStep === 1 ? (
                <SetupStepFrame
                    title={t('offline_record.setup.backup_title')}
                    description={t('offline_record.setup.backup_description')}
                    actions={
                        <Button type="button" onClick={onOpenBackup}>
                            {t('offline_record.open_backup')}
                        </Button>
                    }
                />
            ) : null}
            {currentStep === 2 ? (
                <SetupStepFrame
                    title={t('offline_record.setup.address_title')}
                    description={t('offline_record.setup.address_description')}
                    actions={
                        <Button
                            type="button"
                            disabled={!address.trim()}
                            onClick={() => setEnteringPassword(true)}
                        >
                            {t('offline_record.next')}
                        </Button>
                    }
                >
                    <Field>
                        <FieldLabel htmlFor="offline-record-address">
                            {t('offline_record.address')}
                        </FieldLabel>
                        <Input
                            id="offline-record-address"
                            value={address}
                            placeholder="http://192.168.1.10:8787"
                            onChange={(event) => setAddress(event.target.value)}
                        />
                    </Field>
                </SetupStepFrame>
            ) : null}
            {currentStep === 3 ? (
                <SetupStepFrame
                    title={t('offline_record.setup.password_title')}
                    description={t('offline_record.setup.password_description')}
                    actions={
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={busy}
                                onClick={() => setEnteringPassword(false)}
                            >
                                {t('offline_record.back')}
                            </Button>
                            <Button
                                type="button"
                                disabled={busy || !password}
                                onClick={() =>
                                    onConnect(address.trim(), password)
                                }
                            >
                                {t('offline_record.connect')}
                            </Button>
                        </>
                    }
                >
                    <Field data-disabled={busy}>
                        <FieldLabel htmlFor="offline-record-password">
                            {t('offline_record.password')}
                        </FieldLabel>
                        <Input
                            id="offline-record-password"
                            type="password"
                            value={password}
                            disabled={busy}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                        />
                    </Field>
                    {error ? (
                        <p className="text-destructive text-xs leading-relaxed">
                            {error}
                        </p>
                    ) : null}
                </SetupStepFrame>
            ) : null}
            {currentStep === 4 && session ? (
                <SetupStepFrame
                    title={t('offline_record.setup.login_title')}
                    description={t('offline_record.setup.login_description')}
                    actions={
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={busy}
                            onClick={onCancelSetup}
                        >
                            {t('offline_record.disconnect')}
                        </Button>
                    }
                >
                    <VrchatLoginForm
                        session={session}
                        busy={busy}
                        savedCredentialsAvailable={savedCredentialsAvailable}
                        run={run}
                    />
                </SetupStepFrame>
            ) : null}
        </div>
    );
}
