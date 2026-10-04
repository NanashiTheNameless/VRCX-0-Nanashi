import {
    commands,
    type LocalFavoriteGroupInput as IpcLocalFavoriteGroupInput,
    type LocalFavoriteGroupRenameInput as IpcLocalFavoriteGroupRenameInput,
    type LocalFavoriteInput as IpcLocalFavoriteInput,
    type FavoriteEntityKind,
    type FavoriteRow
} from '@/platform/tauri/bindings';

import configRepository from './configRepository';

type LocalFavoriteKind = FavoriteEntityKind;

interface WorldFavoriteRow {
    created_at: string;
    worldId: string;
    groupName: string;
}

interface LocalFavoriteInput {
    kind: LocalFavoriteKind;
    entityId?: string;
    groupName?: string;
}

interface LocalFavoriteGroupInput {
    kind: LocalFavoriteKind;
    groupName?: string;
}

interface RenameLocalFavoriteGroupInput extends LocalFavoriteGroupInput {
    newGroupName?: string;
}

function applyLocalFavoriteGroupWrite(write: {
    configKey: string;
    groupNames: string[];
}): void {
    configRepository.applyServerEntry(
        write.configKey,
        JSON.stringify(write.groupNames)
    );
}

function normalizeWorldFavoriteRow(row: FavoriteRow): WorldFavoriteRow {
    return {
        created_at: normalizeEntityId(row.createdAt),
        worldId: normalizeEntityId(row.worldId),
        groupName: normalizeGroupName(row.groupName)
    };
}

function normalizeEntityId(value?: string | null) {
    return value?.trim() ?? '';
}

function normalizeGroupName(value?: string | null) {
    return value?.trim() ?? '';
}

async function createLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const normalizedGroupName = normalizeGroupName(groupName);
    if (!normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.createLocalFavoriteGroup requires kind and groupName.'
        );
    }
    const input = {
        kind,
        groupName: normalizedGroupName
    } satisfies IpcLocalFavoriteGroupInput;

    applyLocalFavoriteGroupWrite(
        await commands.appLocalFavoriteGroupCreate(input)
    );
}

async function getWorldFavorites() {
    return (await commands.appFavoriteList('world')).map(
        normalizeWorldFavoriteRow
    );
}

async function addLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.addLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    const input = {
        kind,
        entityId: normalizedEntityId,
        groupName: normalizedGroupName
    } satisfies IpcLocalFavoriteInput;

    return commands.appLocalFavoriteAdd(input);
}

function addAvatarToFavorites(avatarId: string, groupName: string) {
    return addLocalFavorite({
        kind: 'avatar',
        entityId: avatarId,
        groupName
    });
}

function addWorldToFavorites(worldId: string, groupName: string) {
    return addLocalFavorite({
        kind: 'world',
        entityId: worldId,
        groupName
    });
}

function addFriendToLocalFavorites(userId: string, groupName: string) {
    return addLocalFavorite({
        kind: 'friend',
        entityId: userId,
        groupName
    });
}

async function removeLocalFavorite({
    kind,
    entityId,
    groupName
}: LocalFavoriteInput) {
    const normalizedEntityId = normalizeEntityId(entityId);
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!normalizedEntityId || !normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.removeLocalFavorite requires kind, entityId, and groupName.'
        );
    }

    const input = {
        kind,
        entityId: normalizedEntityId,
        groupName: normalizedGroupName
    } satisfies IpcLocalFavoriteInput;

    return commands.appLocalFavoriteRemove(input);
}

async function renameLocalFavoriteGroup({
    kind,
    groupName,
    newGroupName
}: RenameLocalFavoriteGroupInput) {
    const normalizedGroupName = normalizeGroupName(groupName);
    const normalizedNewGroupName = normalizeGroupName(newGroupName);

    if (!normalizedGroupName || !normalizedNewGroupName) {
        throw new Error(
            'LocalFavoritesRepository.renameLocalFavoriteGroup requires kind, groupName, and newGroupName.'
        );
    }

    const input = {
        kind,
        groupName: normalizedGroupName,
        newGroupName: normalizedNewGroupName
    } satisfies IpcLocalFavoriteGroupRenameInput;

    const write = await commands.appLocalFavoriteGroupRename(input);
    applyLocalFavoriteGroupWrite(write);
    return write.affected;
}

async function deleteLocalFavoriteGroup({
    kind,
    groupName
}: LocalFavoriteGroupInput) {
    const normalizedGroupName = normalizeGroupName(groupName);

    if (!normalizedGroupName) {
        throw new Error(
            'LocalFavoritesRepository.deleteLocalFavoriteGroup requires kind and groupName.'
        );
    }

    const input = {
        kind,
        groupName: normalizedGroupName
    } satisfies IpcLocalFavoriteGroupInput;

    const write = await commands.appLocalFavoriteGroupDelete(input);
    applyLocalFavoriteGroupWrite(write);
    return write.affected;
}

const favoritePersistenceRepository = Object.freeze({
    addAvatarToFavorites,
    addFriendToLocalFavorites,
    addWorldToFavorites,
    createLocalFavoriteGroup,
    getWorldFavorites,
    addLocalFavorite,
    removeLocalFavorite,
    renameLocalFavoriteGroup,
    deleteLocalFavoriteGroup
});

export default favoritePersistenceRepository;
