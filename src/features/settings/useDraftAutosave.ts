import { useCallback, useEffect, useRef, useState } from 'react';

export type DraftSaveMode = 'idle' | 'saving' | 'saved' | 'error' | 'review';

type DraftAutosaveOptions<T> = {
    draft: T | null;
    /** JSON of the last saved draft. */
    saved: string;
    save: (draft: T) => Promise<void>;
    /** Changes that must be saved by hand, such as ones that need a confirmation. */
    needsReview?: (draft: T) => boolean;
    /** Called when the view closes while a change still waits for review. */
    onLeaveUnsaved?: () => void;
    delayMs?: number;
};

export function useDraftAutosave<T>({
    draft,
    saved,
    save,
    needsReview,
    onLeaveUnsaved,
    delayMs = 700
}: DraftAutosaveOptions<T>) {
    const serialized = draft === null ? null : JSON.stringify(draft);
    const dirty = serialized !== null && serialized !== saved;
    const review = dirty && draft !== null && (needsReview?.(draft) ?? false);
    const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
        'idle'
    );
    const [error, setError] = useState('');
    const latest = useRef({ draft, save, review, dirty, onLeaveUnsaved });
    const pending = useRef<T | null>(null);

    useEffect(() => {
        latest.current = { draft, save, review, dirty, onLeaveUnsaved };
    });

    const runSave = useCallback(async (value: T) => {
        setState('saving');
        setError('');
        try {
            await latest.current.save(value);
            setState('saved');
        } catch (reason) {
            setState('error');
            setError(reason instanceof Error ? reason.message : String(reason));
        }
    }, []);

    useEffect(() => {
        const value = latest.current.draft;
        if (!dirty || review || value === null) {
            pending.current = null;
            return;
        }
        pending.current = value;
        const timer = setTimeout(() => {
            pending.current = null;
            void runSave(value);
        }, delayMs);
        return () => clearTimeout(timer);
    }, [serialized, dirty, review, delayMs, runSave]);

    // Leaving the page saves a change that was still waiting for its delay.
    useEffect(
        () => () => {
            const value = pending.current;
            if (value !== null) {
                pending.current = null;
                void latest.current.save(value).catch(() => {});
            } else if (latest.current.dirty && latest.current.review) {
                latest.current.onLeaveUnsaved?.();
            }
        },
        []
    );

    const saveNow = useCallback(async () => {
        const value = latest.current.draft;
        if (value === null) return;
        pending.current = null;
        await runSave(value);
    }, [runSave]);

    const mode: DraftSaveMode = review
        ? 'review'
        : state === 'error' && dirty
          ? 'error'
          : state === 'saving' || dirty
            ? 'saving'
            : state === 'saved'
              ? 'saved'
              : 'idle';

    return { dirty, mode, error, saveNow };
}
