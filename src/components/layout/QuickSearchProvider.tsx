import {
    lazy,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { MountOnFirstOpen } from '@/components/hosts/MountOnFirstOpen';
import { directAccessParse } from '@/services/directAccessService';
import { getClipboardText } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { QuickSearchContext } from './useQuickSearchActions';

// The search UI loads on first open and then stays mounted, so closing keeps
// its input until the close animation finishes.
const QuickSearchDialog = lazy(() =>
    import('@/components/sidebar/QuickSearchDialog').then((module) => ({
        default: module.QuickSearchDialog
    }))
);

export function QuickSearchProvider({
    children,
    enabled
}: {
    children: ReactNode;
    enabled: boolean;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const [search, setSearch] = useState({
        open: false,
        query: '',
        retryInput: '',
        clipboardSession: 0
    });
    const pendingOperation = useRef<object | null>(null);
    const busy = useRef(false);

    const closeQuickSearch = useCallback(() => {
        pendingOperation.current = null;
        setSearch((current) => ({ ...current, open: false }));
    }, []);

    useEffect(() => {
        closeQuickSearch();
        return () => {
            pendingOperation.current = null;
        };
    }, [closeQuickSearch, currentEndpoint, currentUserId, enabled]);

    const openQuickSearch = useCallback(() => {
        if (!enabled) {
            return;
        }
        pendingOperation.current = null;
        setSearch((current) => ({
            open: true,
            query: '',
            retryInput: '',
            clipboardSession: current.clipboardSession + 1
        }));
    }, [enabled]);

    const performDirectAccess = useCallback(
        async (input?: string) => {
            const operation = {};
            let value = input?.trim() ?? '';
            let toastId: string | undefined;
            let opened = false;
            try {
                busy.current = true;
                pendingOperation.current = operation;
                setSearch((current) => ({ ...current, open: false }));
                toastId = toast.add({
                    type: 'loading',
                    title: t('prompt.direct_access_omni.message.opening')
                });
                if (input === undefined) {
                    value = (await getClipboardText()).trim();
                }
                if (pendingOperation.current !== operation) {
                    return;
                }
                opened = Boolean(value) && (await directAccessParse(value));
            } catch (error) {
                console.warn('Direct access failed:', error);
            } finally {
                busy.current = false;
                if (toastId) {
                    toast.close(toastId);
                }
            }
            if (pendingOperation.current !== operation) {
                return;
            }
            pendingOperation.current = null;
            if (opened) {
                return;
            }
            setSearch((current) => ({
                open: true,
                query: value,
                retryInput: value,
                clipboardSession: current.clipboardSession + 1
            }));
            if (value) {
                toast.add({
                    type: 'error',
                    title: t('prompt.direct_access_omni.description_failed')
                });
            }
        },
        [t]
    );

    const openDirectAccess = useCallback(
        (input?: string) => {
            if (!enabled || busy.current) {
                return;
            }
            void performDirectAccess(input).catch((error: unknown) => {
                console.warn('Direct access feedback failed:', error);
            });
        },
        [enabled, performDirectAccess]
    );

    const actions = useMemo(
        () => ({
            openQuickSearch,
            openDirectAccessFromClipboard: () => openDirectAccess()
        }),
        [openDirectAccess, openQuickSearch]
    );

    return (
        <QuickSearchContext value={actions}>
            {children}
            <MountOnFirstOpen open={enabled && search.open}>
                <QuickSearchDialog
                    open={enabled && search.open}
                    query={search.query}
                    retryInput={search.retryInput}
                    clipboardSession={search.clipboardSession}
                    onQueryChange={(query) =>
                        setSearch((current) => ({ ...current, query }))
                    }
                    onOpenChange={(open) => {
                        if (!open) {
                            closeQuickSearch();
                        }
                    }}
                    onOpenChangeComplete={(open) => {
                        if (!open) {
                            setSearch((current) =>
                                current.open
                                    ? current
                                    : { ...current, query: '', retryInput: '' }
                            );
                        }
                    }}
                    onDirectAccess={openDirectAccess}
                />
            </MountOnFirstOpen>
        </QuickSearchContext>
    );
}
