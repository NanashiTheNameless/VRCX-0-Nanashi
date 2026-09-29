import { create } from 'zustand';

interface MyGroupsRevisionStoreState {
    revision: number;
    bumpRevision(): void;
}

export const useMyGroupsRevisionStore = create<MyGroupsRevisionStoreState>(
    (set) => ({
        revision: 0,
        bumpRevision() {
            set((state) => ({ revision: state.revision + 1 }));
        }
    })
);
