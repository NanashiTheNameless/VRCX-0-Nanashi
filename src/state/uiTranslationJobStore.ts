import { create } from 'zustand';

import {
    translateUiToCustomLocale,
    type TranslateUiOptions,
    type UiTranslationProgress
} from '@/services/customLocaleService';
import i18n from '@/services/i18nService';
import { setAppLanguagePreference } from '@/services/preferencesService';
import { toast } from '@/services/toastService';

// Fork: the UI translation job lives here rather than in the settings card, so
// it keeps running (with progress, cancel and a completion toast) after the
// user leaves the settings page.

type UiTranslationJob = {
    code: string;
    name: string;
    progress: UiTranslationProgress;
};

type UiTranslationJobInput = Omit<TranslateUiOptions, 'signal' | 'onProgress'>;

type UiTranslationJobStore = {
    job: UiTranslationJob | null;
    start(input: UiTranslationJobInput): boolean;
    cancel(): void;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

let controller: AbortController | null = null;

export const useUiTranslationJobStore = create<UiTranslationJobStore>(
    (set, get) => ({
        job: null,
        start(input) {
            if (get().job) {
                return false;
            }
            const current = new AbortController();
            controller = current;
            set({
                job: {
                    code: input.code,
                    name: input.name,
                    progress: { done: 0, total: 0, failed: 0 }
                }
            });
            void translateUiToCustomLocale({
                ...input,
                signal: current.signal,
                onProgress: (progress) =>
                    set((state) =>
                        state.job ? { job: { ...state.job, progress } } : state
                    )
            })
                .then((entry) => {
                    toast.add({
                        type: 'success',
                        title: i18n.t(
                            'view.settings.custom_languages.translate_done',
                            { name: entry.name }
                        ),
                        actionProps: {
                            children: i18n.t(
                                'view.settings.custom_languages.use_now'
                            ),
                            onClick: () => {
                                void setAppLanguagePreference(entry.code);
                            }
                        }
                    });
                })
                .catch((error: unknown) => {
                    toast.add({ type: 'error', title: errorMessage(error) });
                })
                .finally(() => {
                    if (controller === current) {
                        controller = null;
                    }
                    set({ job: null });
                });
            return true;
        },
        cancel() {
            controller?.abort();
        }
    })
);
