import { create } from 'zustand';

interface RoomMutualScanStoreState {
    running: boolean;
    setRunning(running: boolean): void;
}

export const useRoomMutualScanStore = create<RoomMutualScanStoreState>(
    (set) => ({
        running: false,
        setRunning(running) {
            set({ running });
        }
    })
);
