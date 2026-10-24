import {
    commands,
    type InstanceActivityRowOutput,
    type WorldSummaryOutput
} from '@/platform/tauri/bindings';
import { displayDayKey as toLocalDayKey } from '@/shared/utils/displayTimeZone';
import { displayDateBoundary } from '@/shared/utils/displayTimeZone';

export interface InstanceActivityRow {
    id: number;
    created_at: number;
    type: string;
    display_name: string;
    location: string;
    user_id: string;
    time: number;
}

type WorldSummary = WorldSummaryOutput;

function normalizeInstanceActivityRow(
    row: InstanceActivityRowOutput
): InstanceActivityRow {
    return {
        id: row.id,
        created_at: row.createdAt,
        type: row.type,
        display_name: row.displayName,
        location: row.location,
        user_id: row.userId,
        time: row.time
    };
}

async function getAvailableDates(userId: string): Promise<string[]> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return [];
    }

    const rows = await commands.appInstanceActivityDatesGet(normalizedUserId);
    return [...new Set(rows.map(toLocalDayKey).filter(Boolean))];
}

async function getInstanceActivityRows(
    startDate: string,
    endDate: string
): Promise<InstanceActivityRow[]> {
    const rows = await commands.appInstanceActivityRowsGet(
        displayDateBoundary(startDate, 'start') ?? 0,
        displayDateBoundary(endDate, 'end') ?? 0
    );

    return rows.map((row) => normalizeInstanceActivityRow(row));
}

async function getWorldSummariesByIds(
    worldIds: readonly string[]
): Promise<Record<string, WorldSummary>> {
    const ids = Array.from(
        new Set(worldIds.map((worldId) => worldId.trim()).filter(Boolean))
    );
    if (!ids.length) {
        return {};
    }

    const rows = await commands.appWorldSummariesGet(ids);

    const map: Record<string, WorldSummary> = {};
    for (const [worldId, row] of Object.entries(rows)) {
        if (!row) {
            continue;
        }
        const world = {
            ...row,
            id: row.id || worldId
        };
        if (!world.id) {
            continue;
        }
        map[world.id] = world;
    }

    return map;
}

const instanceActivityRepository = {
    getAvailableDates,
    getInstanceActivityRows,
    getWorldSummariesByIds
};

export default instanceActivityRepository;
