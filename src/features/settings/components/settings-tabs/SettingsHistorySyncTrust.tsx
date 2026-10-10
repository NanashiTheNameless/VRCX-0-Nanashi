import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '@/platform/tauri/generatedInvoke';

type Trust = {
    instance: 'official' | 'unattested' | 'invalid' | 'unreachable';
    instanceDetail: string;
    apiOrigin: string;
    websiteOrigin: string;
    code: 'official' | 'unsigned' | 'modified' | 'unreachable';
    codeDetail: string;
    version: string | null;
    sourceCommit: string | null;
    codeOfficialAtMs: number | null;
    instanceOfficialAtMs: number | null;
};

// Two separate questions: is this the maintainer's server, and does its
// website run the maintainer's signed code. Each failure is explained on its
// own, and neither stops syncing.
export function SettingsHistorySyncTrust({ serverKey }: { serverKey: string }) {
    const { t } = useTranslation();
    const [trust, setTrust] = useState<Trust>();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let current = true;
        setTrust(undefined);
        setFailed(false);
        invoke<Trust>('app__remote_sync_trust_check')
            .then((result) => {
                if (current) setTrust(result);
            })
            .catch(() => {
                if (current) setFailed(true);
            });
        return () => {
            current = false;
        };
    }, [serverKey]);

    if (failed) {
        return (
            <p className="text-muted-foreground text-sm">
                {t('view.settings.history_sync.trust.check_failed')}
            </p>
        );
    }
    if (!trust) {
        return (
            <p className="text-muted-foreground text-sm">
                {t('view.settings.history_sync.trust.checking')}
            </p>
        );
    }

    const codeWarning = trust.code !== 'official';
    const instanceWarning = trust.instance !== 'official';
    if (!instanceWarning && !codeWarning) {
        return (
            <p className="text-sm text-green-600">
                {t('view.settings.history_sync.trust.all_good', {
                    version: trust.version ?? '',
                    commit: trust.sourceCommit ?? ''
                })}
            </p>
        );
    }

    return (
        <div className="space-y-3 rounded-md border border-amber-600 p-3 text-sm">
            {instanceWarning ? (
                <div>
                    <p className="font-medium text-amber-600">
                        {t(
                            `view.settings.history_sync.trust.instance_${trust.instance}_title`
                        )}
                    </p>
                    <p>
                        {t(
                            `view.settings.history_sync.trust.instance_${trust.instance}_body`,
                            {
                                api: trust.apiOrigin,
                                website: trust.websiteOrigin
                            }
                        )}
                    </p>
                    {trust.instance !== 'unreachable' &&
                    trust.instanceOfficialAtMs ? (
                        <p className="text-destructive font-medium">
                            {t(
                                'view.settings.history_sync.trust.was_official',
                                {
                                    time: new Date(
                                        trust.instanceOfficialAtMs
                                    ).toLocaleString()
                                }
                            )}
                        </p>
                    ) : null}
                    {trust.instanceDetail ? (
                        <p className="text-muted-foreground">
                            {trust.instanceDetail}
                        </p>
                    ) : null}
                </div>
            ) : null}
            {codeWarning ? (
                <div>
                    <p className="font-medium text-amber-600">
                        {t(
                            `view.settings.history_sync.trust.code_${trust.code}_title`
                        )}
                    </p>
                    <p>
                        {t(
                            `view.settings.history_sync.trust.code_${trust.code}_body`,
                            { website: trust.websiteOrigin }
                        )}
                    </p>
                    {trust.code !== 'unreachable' && trust.codeOfficialAtMs ? (
                        <p className="text-destructive font-medium">
                            {t(
                                'view.settings.history_sync.trust.was_official',
                                {
                                    time: new Date(
                                        trust.codeOfficialAtMs
                                    ).toLocaleString()
                                }
                            )}
                        </p>
                    ) : null}
                    {trust.codeDetail ? (
                        <p className="text-muted-foreground">
                            {trust.codeDetail}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <p className="text-muted-foreground">
                {t('view.settings.history_sync.trust.not_blocking')}
            </p>
        </div>
    );
}
