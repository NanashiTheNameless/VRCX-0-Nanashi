import { ShieldAlertIcon } from 'lucide-react';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type SafetyLogRow } from '@/platform/tauri/bindings';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type Row = {
    type?: string | null;
    created_at?: string;
    userId?: string | null;
    location?: string | null;
    videoUrl?: string | null;
    resourceUrl?: string | null;
    data?: string | null;
    message?: string | null;
};
type Context = {
    accountUserId: string;
    register: (key: string, row: SafetyLogRow) => () => void;
    warnings: ReadonlyMap<string, string[]>;
};
const SafetyContext = createContext<Context | null>(null);
export const SafetyLogLocationContext = createContext('');

/** Only mounted rows are inspected. Requests are batched and never open the logged URLs. */
export function SafetyLogProvider({
    accountUserId,
    children
}: {
    accountUserId: string;
    children: ReactNode;
}) {
    const { t } = useTranslation();
    const rows = useRef(
        new Map<string, { row: SafetyLogRow; count: number }>()
    );
    const revision = useRef(0);
    const mounted = useRef(true);
    const running = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [warnings, setWarnings] = useState<ReadonlyMap<string, string[]>>(
        new Map()
    );
    const [failed, setFailed] = useState(false);
    const flush = useCallback(async () => {
        if (running.current || !mounted.current) return;
        const batch = [...rows.current.entries()];
        if (!batch.length) return;
        running.current = true;
        const expected = revision.current;
        try {
            const next = new Map<string, string[]>();
            for (let offset = 0; offset < batch.length; offset += 200) {
                const chunk = batch.slice(offset, offset + 200);
                const results = await commands.appSafetyRowsInspect(
                    chunk.map(([, value]) => value.row)
                );
                if (!mounted.current || expected !== revision.current) return;
                chunk.forEach(([key], i) => next.set(key, results[i] || []));
            }
            if (mounted.current && expected === revision.current) {
                setWarnings(next);
                setFailed(false);
            }
        } catch {
            if (mounted.current && expected === revision.current) {
                setWarnings(new Map());
                setFailed(true);
            }
        } finally {
            running.current = false;
        }
    }, []);
    const schedule = useCallback(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            void flush();
        }, 0);
    }, [flush]);
    const register = useCallback(
        (key: string, row: SafetyLogRow) => {
            const current = rows.current.get(key);
            rows.current.set(key, { row, count: (current?.count || 0) + 1 });
            revision.current += 1;
            schedule();
            return () => {
                const value = rows.current.get(key);
                if (value && value.count > 1)
                    rows.current.set(key, { ...value, count: value.count - 1 });
                else rows.current.delete(key);
                revision.current += 1;
                schedule();
            };
        },
        [schedule]
    );
    useEffect(() => {
        mounted.current = true;
        const poll = setInterval(() => void flush(), 5000);
        return () => {
            mounted.current = false;
            clearInterval(poll);
            if (timer.current !== null) clearTimeout(timer.current);
        };
    }, [flush]);
    const value = useMemo(
        () => ({ accountUserId, register, warnings }),
        [accountUserId, register, warnings]
    );
    return (
        <SafetyContext value={value}>
            {failed && (
                <p role="status" className="text-destructive text-sm">
                    {t('view.settings.safety.log_badges_unavailable')}
                </p>
            )}
            {children}
        </SafetyContext>
    );
}

export function SafetyLogBadge({ row }: { row: Row }) {
    const context = useContext(SafetyContext);
    const sessionLocation = useContext(SafetyLogLocationContext);
    const { t } = useTranslation();
    const input: SafetyLogRow = {
        accountUserId: context?.accountUserId || '',
        kind: row.type || '',
        createdAt: row.created_at || '',
        userId: row.userId || '',
        location: row.location || sessionLocation,
        url: (row.videoUrl || row.resourceUrl || '').slice(0, 8192),
        data: (row.data || row.message || '').slice(0, 16384)
    };
    const key = JSON.stringify(input);
    const register = context?.register;
    useEffect(
        () => register?.(key, JSON.parse(key) as SafetyLogRow),
        [key, register]
    );
    const messages = context?.warnings.get(key) || [];
    if (!messages.length) return null;
    const label = `${t('view.settings.safety.log_badge')}: ${messages.join(' ')}`;
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        role="img"
                        aria-label={label}
                        tabIndex={0}
                        className="inline-flex shrink-0 text-amber-600"
                    >
                        <ShieldAlertIcon
                            aria-hidden="true"
                            className="size-4"
                        />
                    </span>
                }
            />
            <TooltipContent className="max-w-sm">
                {messages.map((message) => (
                    <p key={message}>{message}</p>
                ))}
            </TooltipContent>
        </Tooltip>
    );
}
