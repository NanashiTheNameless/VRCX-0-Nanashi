import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type YtdlpSettings,
    type YtdlpStatus
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const P = 'view.settings.ytdlp';
const browsers = [
    'firefox',
    'chrome',
    'edge',
    'brave',
    'chromium',
    'vivaldi',
    'opera'
];
export function SettingsYtdlpCard() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<YtdlpStatus | null>(null);
    const [settings, setSettings] = useState<YtdlpSettings | null>(null);
    const [browser, setBrowser] = useState('');
    const [profile, setProfile] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const next = await commands.appYtdlpStatus();
                if (active) {
                    setStatus(next);
                    setSettings(
                        (old) =>
                            old || {
                                ...next.settings,
                                toolsPath: next.toolsPath
                            }
                    );
                }
            } catch (reason) {
                if (active) setError(String(reason));
            }
        };
        void load();
        const timer = setInterval(() => void load(), 3000);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, []);
    async function run(action: () => Promise<YtdlpStatus>) {
        setBusy(true);
        setError('');
        try {
            const next = await action();
            setStatus(next);
            setSettings({ ...next.settings, toolsPath: next.toolsPath });
        } catch (reason) {
            setError(String(reason));
            try {
                const next = await commands.appYtdlpStatus();
                setStatus(next);
                setSettings({ ...next.settings, toolsPath: next.toolsPath });
            } catch {
                /* Keep the actionable error. */
            }
        } finally {
            setBusy(false);
        }
    }
    async function save() {
        if (!settings) return;
        if (settings.enabled && !status?.settings.enabled) {
            const answer = await useModalStore.getState().confirm({
                title: t(`${P}.enable_title`),
                description: t(`${P}.enable_confirm`, {
                    path: settings.toolsPath
                }),
                confirmText: t(`${P}.install`),
                cancelText: t('common.actions.cancel')
            });
            if (!answer.ok) return;
        }
        await run(() => commands.appYtdlpConfigure(settings));
    }
    async function refresh() {
        if (!browser) return;
        const answer = await useModalStore.getState().confirm({
            title: t(`${P}.read_title`),
            description: t(`${P}.read_confirm`, {
                browser,
                profile: profile || t(`${P}.default_profile`)
            }),
            confirmText: t(`${P}.refresh`),
            cancelText: t('common.actions.cancel')
        });
        if (answer.ok)
            await run(() => commands.appYtdlpRefreshCookies(browser, profile));
    }
    async function importFile() {
        const path = await commands.appOpenFileSelectorDialog(
            null,
            null,
            'Netscape cookies|*.txt'
        );
        if (typeof path === 'string')
            await run(() => commands.appYtdlpImportCookies(path));
    }
    const locked = busy || status?.busy === true;
    const savedCookies = status?.settings.enabled && status.settings.useCookies;
    const dirty =
        settings &&
        status &&
        JSON.stringify(settings) !==
            JSON.stringify({ ...status.settings, toolsPath: status.toolsPath });
    return (
        <SettingsCard
            cardId="media.ytdlp"
            title={t(`${P}.title`)}
            description={t(`${P}.description`)}
        >
            {error && (
                <p role="alert" className="text-destructive text-sm">
                    {error}
                </p>
            )}
            {!status || !settings ? (
                <p role="status">{t(`${P}.loading`)}</p>
            ) : (
                <>
                    {!status.supported && <p>{t(`${P}.unsupported`)}</p>}
                    <Field
                        label={t(`${P}.enable`)}
                        description={t(`${P}.enable_description`)}
                    >
                        <Switch
                            aria-label={t(`${P}.enable`)}
                            checked={settings.enabled}
                            disabled={locked || !status.supported}
                            onCheckedChange={(enabled) =>
                                setSettings({ ...settings, enabled })
                            }
                        />
                    </Field>
                    <Field
                        label={t(`${P}.tools`)}
                        description={t(`${P}.tools_help`)}
                    >
                        <Input
                            aria-label={t(`${P}.tools`)}
                            value={settings.toolsPath}
                            disabled={locked || status.settings.enabled}
                            onChange={(e) =>
                                setSettings({
                                    ...settings,
                                    toolsPath: e.target.value
                                })
                            }
                        />
                    </Field>
                    <Field
                        label={t(`${P}.cookies`)}
                        description={t(`${P}.cookies_opt_in`)}
                    >
                        <Switch
                            aria-label={t(`${P}.cookies`)}
                            checked={settings.useCookies}
                            disabled={locked || !settings.enabled}
                            onCheckedChange={(useCookies) =>
                                setSettings({ ...settings, useCookies })
                            }
                        />
                    </Field>
                    <Button
                        disabled={locked || !status.supported}
                        onClick={() => void save()}
                    >
                        {settings.enabled ? t(`${P}.save`) : t(`${P}.restore`)}
                    </Button>
                    {dirty && (
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.unsaved`)}
                        </p>
                    )}
                    {settings.useCookies && (
                        <fieldset
                            disabled={locked || !savedCookies || Boolean(dirty)}
                            className="space-y-3 rounded-md border p-3 disabled:opacity-60"
                        >
                            <legend>{t(`${P}.cookie_source`)}</legend>
                            <p className="text-muted-foreground text-sm">
                                {t(`${P}.cookie_help`)}
                            </p>
                            <label className="block space-y-1">
                                <span>{t(`${P}.browser`)}</span>
                                <select
                                    className="bg-background w-full rounded-md border p-2"
                                    aria-label={t(`${P}.browser`)}
                                    value={browser}
                                    onChange={(e) => setBrowser(e.target.value)}
                                >
                                    <option value="">
                                        {t(`${P}.choose_browser`)}
                                    </option>
                                    {browsers.map((name) => (
                                        <option key={name} value={name}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span>{t(`${P}.profile`)}</span>
                                <Input
                                    aria-label={t(`${P}.profile`)}
                                    value={profile}
                                    onChange={(e) => setProfile(e.target.value)}
                                    placeholder={t(`${P}.default_profile`)}
                                />
                            </label>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    disabled={!browser}
                                    onClick={() => void refresh()}
                                >
                                    {t(`${P}.refresh`)}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        void importFile().catch((reason) =>
                                            setError(String(reason))
                                        )
                                    }
                                >
                                    {t(`${P}.import`)}
                                </Button>
                            </div>
                        </fieldset>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="outline"
                            disabled={
                                locked ||
                                !status.settings.enabled ||
                                Boolean(dirty)
                            }
                            onClick={() => void run(commands.appYtdlpUpdate)}
                        >
                            {t(`${P}.update`)}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={
                                locked ||
                                !status.settings.enabled ||
                                Boolean(dirty)
                            }
                            onClick={() => void run(commands.appYtdlpTest)}
                        >
                            {t(`${P}.test`)}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={locked || status.cookieCount === 0}
                            onClick={() =>
                                void run(commands.appYtdlpClearCookies)
                            }
                        >
                            {t(`${P}.clear`)}
                        </Button>
                    </div>
                    <div role="status" className="space-y-1 text-sm">
                        <p>
                            {t(`${P}.version`, {
                                version:
                                    status.version || t(`${P}.not_installed`)
                            })}
                        </p>
                        <p>
                            {t(`${P}.provider`, {
                                state: status.providerRunning
                                    ? t(`${P}.running`)
                                    : t(`${P}.stopped`)
                            })}
                        </p>
                        <p>
                            {t(`${P}.last_update`, {
                                time: status.checkedAt || t(`${P}.never`)
                            })}
                        </p>
                        <p>
                            {t(`${P}.cookie_status`, {
                                count: status.cookieCount,
                                time:
                                    status.cookiesRefreshedAt || t(`${P}.never`)
                            })}
                        </p>
                        {status.cookieExpiry > 0 && (
                            <p>
                                {t(`${P}.cookie_expiry`, {
                                    time: new Date(
                                        status.cookieExpiry * 1000
                                    ).toLocaleString()
                                })}
                            </p>
                        )}
                        {status.cookieValidation && (
                            <p>{status.cookieValidation}</p>
                        )}
                        {status.message && <p>{status.message}</p>}
                    </div>
                    <p className="text-muted-foreground text-sm">
                        {t(`${P}.limits`)}
                    </p>
                </>
            )}
        </SettingsCard>
    );
}
