import { create } from 'zustand';

import type { BoopEmojiChoice } from '@/domain/entities/boopEmoji';

type AlertMode = 'alert' | 'confirm';
type OtpMode = 'totp' | 'emailOtp' | 'otp';
type ModalResult<TValue> = {
    ok: boolean;
    reason: string;
    value?: TValue;
};
type ModalResolver<TValue> = (result: ModalResult<TValue>) => void;
type AlertDialogState = {
    open: boolean;
    mode: AlertMode;
    title: string;
    description: string;
    confirmText: string;
    alternativeText: string;
    cancelText: string;
    dismissible: boolean;
    destructive: boolean;
};
type PromptDialogState = {
    open: boolean;
    title: string;
    description: string;
    value: string;
    confirmText: string;
    cancelText: string;
    dismissible: boolean;
    inputType: string;
    inputPattern: RegExp | null;
    multiline: boolean;
};
type OtpDialogState = {
    open: boolean;
    title: string;
    description: string;
    value: string;
    mode: OtpMode;
    confirmText: string;
    cancelText: string;
    dismissible: boolean;
};
type ImageDialogState = {
    open: boolean;
    url: string;
    title: string;
    fileName: string;
    sourcePath: string;
};
type BoopDialogState = {
    open: boolean;
    targetLabel: string;
    dismissible: boolean;
};
type AlertDialogOptions = Partial<AlertDialogState>;
type PromptDialogOptions = Partial<PromptDialogState> & {
    inputValue?: string;
    pattern?: RegExp | null;
    errorMessage?: string;
};
type OtpDialogOptions = Partial<OtpDialogState>;
type ImageDialogOptions = Partial<ImageDialogState>;
type BoopDialogOptions = Partial<BoopDialogState>;
type ModalStore = {
    alertDialog: AlertDialogState;
    promptDialog: PromptDialogState;
    otpDialog: OtpDialogState;
    imageDialog: ImageDialogState;
    boopDialog: BoopDialogState;
    alert(options?: AlertDialogOptions): Promise<ModalResult<never>>;
    confirm(options?: AlertDialogOptions): Promise<ModalResult<never>>;
    prompt(options?: PromptDialogOptions): Promise<ModalResult<string>>;
    boopPrompt(
        options?: BoopDialogOptions
    ): Promise<ModalResult<BoopEmojiChoice | null>>;
    otpPrompt(options?: OtpDialogOptions): Promise<ModalResult<string>>;
    openImagePreview(options?: ImageDialogOptions): void;
    updatePromptValue(value: string): void;
    updateOtpValue(value: string): void;
    handleOk(): void;
    handleAlternative(): void;
    handleCancel(): void;
    handleDismiss(): void;
    handleAlertCloseComplete(): void;
    handlePromptOk(value?: string): void;
    handlePromptCancel(value?: string): void;
    handlePromptDismiss(value?: string): void;
    handleBoopOk(value: BoopEmojiChoice | null): void;
    handleBoopCancel(): void;
    handleBoopDismiss(): void;
    handleOtpOk(value?: string): void;
    handleOtpCancel(value?: string): void;
    handleOtpDismiss(value?: string): void;
    closeImagePreview(): void;
    resetModalState(): void;
};

const createAlertDialogState = (): AlertDialogState => ({
    open: false,
    mode: 'alert',
    title: '',
    description: '',
    confirmText: '',
    alternativeText: '',
    cancelText: '',
    dismissible: true,
    destructive: false
});

const createPromptDialogState = (): PromptDialogState => ({
    open: false,
    title: '',
    description: '',
    value: '',
    confirmText: '',
    cancelText: '',
    dismissible: true,
    inputType: 'text',
    inputPattern: null,
    multiline: false
});

const createOtpDialogState = (): OtpDialogState => ({
    open: false,
    title: '',
    description: '',
    value: '',
    mode: 'totp',
    confirmText: '',
    cancelText: '',
    dismissible: true
});

const createImageDialogState = (): ImageDialogState => ({
    open: false,
    url: '',
    title: '',
    fileName: '',
    sourcePath: ''
});

const createBoopDialogState = (): BoopDialogState => ({
    open: false,
    targetLabel: '',
    dismissible: true
});

function createResult<TValue = never>(
    ok: boolean,
    reason: string,
    value?: TValue
): ModalResult<TValue> {
    return {
        ok,
        reason,
        value
    };
}

function matchesPromptPattern(pattern: RegExp | null, value: string): boolean {
    if (!pattern) {
        return true;
    }

    const flags = pattern.flags.replace(/g/g, '');
    return new RegExp(pattern.source, flags).test(String(value ?? ''));
}

export const useModalStore = create<ModalStore>((set, get) => {
    let pendingAlert: ModalResolver<never> | null = null;
    let pendingPrompt: ModalResolver<string> | null = null;
    let pendingBoop: ModalResolver<BoopEmojiChoice | null> | null = null;
    let pendingOtp: ModalResolver<string> | null = null;

    function resolveAlert(result: ModalResult<never>) {
        const resolver = pendingAlert;
        pendingAlert = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolvePrompt(result: ModalResult<string>) {
        const resolver = pendingPrompt;
        pendingPrompt = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolveBoop(result: ModalResult<BoopEmojiChoice | null>) {
        const resolver = pendingBoop;
        pendingBoop = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function resolveOtp(result: ModalResult<string>) {
        const resolver = pendingOtp;
        pendingOtp = null;
        if (typeof resolver === 'function') {
            resolver(result);
        }
    }

    function hideAlertDialog() {
        set((state) => ({
            alertDialog: {
                ...state.alertDialog,
                open: false
            }
        }));
    }

    function openBaseAlert(mode: AlertMode, options: AlertDialogOptions = {}) {
        if (pendingAlert) {
            resolveAlert(createResult(false, 'replaced'));
        }

        set({
            alertDialog: {
                ...createAlertDialogState(),
                ...options,
                mode,
                open: true
            }
        });

        return new Promise<ModalResult<never>>((resolve) => {
            pendingAlert = resolve;
        });
    }

    function openBasePrompt(options: PromptDialogOptions = {}) {
        if (pendingPrompt) {
            resolvePrompt(
                createResult(false, 'replaced', get().promptDialog.value)
            );
        }

        set({
            promptDialog: {
                ...createPromptDialogState(),
                ...options,
                value:
                    typeof options.inputValue === 'string'
                        ? options.inputValue
                        : createPromptDialogState().value,
                inputType:
                    typeof options.inputType === 'string'
                        ? options.inputType
                        : createPromptDialogState().inputType,
                inputPattern: options.pattern ?? null,
                multiline: Boolean(options.multiline),
                open: true
            }
        });

        return new Promise<ModalResult<string>>((resolve) => {
            pendingPrompt = resolve;
        });
    }

    function openBaseBoop(options: BoopDialogOptions = {}) {
        if (pendingBoop) {
            resolveBoop(createResult(false, 'replaced'));
        }

        set({
            boopDialog: {
                ...createBoopDialogState(),
                ...options,
                open: true,
                targetLabel:
                    typeof options.targetLabel === 'string'
                        ? options.targetLabel
                        : ''
            }
        });

        return new Promise<ModalResult<BoopEmojiChoice | null>>((resolve) => {
            pendingBoop = resolve;
        });
    }

    function openBaseOtp(options: OtpDialogOptions = {}) {
        if (pendingOtp) {
            resolveOtp(createResult(false, 'replaced', get().otpDialog.value));
        }

        set({
            otpDialog: {
                ...createOtpDialogState(),
                ...options,
                mode:
                    options.mode === 'emailOtp' || options.mode === 'otp'
                        ? options.mode
                        : 'totp',
                open: true
            }
        });

        return new Promise<ModalResult<string>>((resolve) => {
            pendingOtp = resolve;
        });
    }

    return {
        alertDialog: createAlertDialogState(),
        promptDialog: createPromptDialogState(),
        otpDialog: createOtpDialogState(),
        imageDialog: createImageDialogState(),
        boopDialog: createBoopDialogState(),
        alert(options?: AlertDialogOptions) {
            return openBaseAlert('alert', options);
        },
        confirm(options?: AlertDialogOptions) {
            return openBaseAlert('confirm', options);
        },
        prompt(options?: PromptDialogOptions) {
            return openBasePrompt(options);
        },
        boopPrompt(options?: BoopDialogOptions) {
            return openBaseBoop(options);
        },
        otpPrompt(options?: OtpDialogOptions) {
            return openBaseOtp(options);
        },
        openImagePreview(options: ImageDialogOptions = {}) {
            set({
                imageDialog: {
                    ...createImageDialogState(),
                    ...options,
                    open: true,
                    url: typeof options.url === 'string' ? options.url : ''
                }
            });
        },
        updatePromptValue(value: string) {
            set((state) => ({
                promptDialog: {
                    ...state.promptDialog,
                    value
                }
            }));
        },
        updateOtpValue(value: string) {
            set((state) => ({
                otpDialog: {
                    ...state.otpDialog,
                    value
                }
            }));
        },
        handleOk() {
            if (!pendingAlert) {
                return;
            }

            hideAlertDialog();
            resolveAlert(createResult(true, 'ok'));
        },
        handleAlternative() {
            if (!pendingAlert) {
                return;
            }

            hideAlertDialog();
            resolveAlert(createResult(true, 'alternative'));
        },
        handleCancel() {
            const { alertDialog } = get();
            if (!pendingAlert) {
                return;
            }

            hideAlertDialog();
            if (alertDialog.mode === 'alert') {
                resolveAlert(createResult(true, 'ok'));
                return;
            }

            resolveAlert(createResult(false, 'cancel'));
        },
        handleDismiss() {
            const { alertDialog } = get();
            if (!pendingAlert || !alertDialog.dismissible) {
                return;
            }

            hideAlertDialog();
            if (alertDialog.mode === 'alert') {
                resolveAlert(createResult(true, 'ok'));
                return;
            }

            resolveAlert(createResult(false, 'dismiss'));
        },
        handleAlertCloseComplete() {
            if (get().alertDialog.open) {
                return;
            }

            set({ alertDialog: createAlertDialogState() });
        },
        handlePromptOk(value = '') {
            const { promptDialog } = get();
            if (!pendingPrompt) {
                return;
            }

            if (!matchesPromptPattern(promptDialog.inputPattern, value ?? '')) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(true, 'ok', value ?? ''));
        },
        handlePromptCancel(value = '') {
            if (!pendingPrompt) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'cancel', value ?? ''));
        },
        handlePromptDismiss(value = '') {
            const { promptDialog } = get();
            if (!pendingPrompt || !promptDialog.dismissible) {
                return;
            }

            set({ promptDialog: createPromptDialogState() });
            resolvePrompt(createResult(false, 'dismiss', value ?? ''));
        },
        handleBoopOk(value: BoopEmojiChoice | null) {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(true, 'ok', value));
        },
        handleBoopCancel() {
            if (!pendingBoop) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'cancel', null));
        },
        handleBoopDismiss() {
            const { boopDialog } = get();
            if (!pendingBoop || !boopDialog.dismissible) {
                return;
            }

            set({ boopDialog: createBoopDialogState() });
            resolveBoop(createResult(false, 'dismiss', null));
        },
        handleOtpOk(value = '') {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(true, 'ok', value ?? ''));
        },
        handleOtpCancel(value = '') {
            if (!pendingOtp) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'cancel', value ?? ''));
        },
        handleOtpDismiss(value = '') {
            const { otpDialog } = get();
            if (!pendingOtp || !otpDialog.dismissible) {
                return;
            }

            set({ otpDialog: createOtpDialogState() });
            resolveOtp(createResult(false, 'dismiss', value ?? ''));
        },
        closeImagePreview() {
            set({ imageDialog: createImageDialogState() });
        },
        resetModalState() {
            if (pendingAlert) {
                resolveAlert(createResult(false, 'replaced'));
            }
            if (pendingPrompt) {
                resolvePrompt(
                    createResult(false, 'replaced', get().promptDialog.value)
                );
            }
            if (pendingBoop) {
                resolveBoop(createResult(false, 'replaced'));
            }
            if (pendingOtp) {
                resolveOtp(
                    createResult(false, 'replaced', get().otpDialog.value)
                );
            }

            set({
                alertDialog: createAlertDialogState(),
                promptDialog: createPromptDialogState(),
                boopDialog: createBoopDialogState(),
                otpDialog: createOtpDialogState(),
                imageDialog: createImageDialogState()
            });
        }
    };
});
