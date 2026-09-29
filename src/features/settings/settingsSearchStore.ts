import { create } from 'zustand';

// Fork: the settings search query, shared by the search box, the results
// list and the tab panels (which all mount while a search is active).
type SettingsSearchState = {
    query: string;
    setQuery(query: string): void;
};

export const useSettingsSearchStore = create<SettingsSearchState>((set) => ({
    query: '',
    setQuery: (query) => set({ query })
}));

export function useSettingsSearchActive(): boolean {
    return useSettingsSearchStore((state) => state.query.trim() !== '');
}
