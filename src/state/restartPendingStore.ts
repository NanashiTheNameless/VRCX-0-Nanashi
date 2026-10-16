import { create } from 'zustand';

export const useRestartPendingStore = create<{ pending: boolean }>(() => ({
    pending: false
}));

export function markRestartPending() {
    useRestartPendingStore.setState({ pending: true });
}
