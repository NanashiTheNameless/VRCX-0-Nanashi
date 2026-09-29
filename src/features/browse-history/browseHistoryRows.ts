import { positionKnownSizeRows } from '@/lib/knownSizeVirtualRows';
import type { BrowseHistoryItemOutput } from '@/platform/tauri/bindings';

export const BROWSE_HISTORY_CARD_HEIGHT = 64;
export const BROWSE_HISTORY_GRID_GAP = 8;
export const BROWSE_HISTORY_HEADING_HEIGHT = 32;

export type BrowseHistoryVirtualRow =
    | {
          key: string;
          kind: 'heading';
          dayKey: string;
          height: number;
      }
    | {
          key: string;
          kind: 'cards';
          items: BrowseHistoryItemOutput[];
          height: number;
      };

export function browseHistoryDayKey(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function buildBrowseHistoryRows(
    items: readonly BrowseHistoryItemOutput[],
    columnCount: number
) {
    const safeColumnCount = Math.max(1, Math.floor(columnCount));
    const rows: BrowseHistoryVirtualRow[] = [];
    let currentDay = '';
    let dayItems: BrowseHistoryItemOutput[] = [];

    const appendDay = () => {
        if (!currentDay || !dayItems.length) {
            return;
        }
        rows.push({
            key: `heading:${currentDay}`,
            kind: 'heading',
            dayKey: currentDay,
            height: BROWSE_HISTORY_HEADING_HEIGHT
        });
        for (let index = 0; index < dayItems.length; index += safeColumnCount) {
            rows.push({
                key: `cards:${currentDay}:${index}`,
                kind: 'cards',
                items: dayItems.slice(index, index + safeColumnCount),
                height: BROWSE_HISTORY_CARD_HEIGHT + BROWSE_HISTORY_GRID_GAP
            });
        }
    };

    for (const item of items) {
        const dayKey = browseHistoryDayKey(item.lastViewedAt);
        if (currentDay && currentDay !== dayKey) {
            appendDay();
            dayItems = [];
        }
        currentDay = dayKey;
        dayItems.push(item);
    }
    appendDay();

    return positionKnownSizeRows<BrowseHistoryVirtualRow>(rows);
}
