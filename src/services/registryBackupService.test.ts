import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireHostCapability: vi.fn<(key: string) => void>(),
    appRegistryBackupList: vi.fn(),
    appRegistryBackupCreate: vi.fn(),
    appRegistryBackupRestore: vi.fn(),
    appRegistryBackupDelete: vi.fn(),
    appRegistryBackupExportToFile: vi.fn(),
    appRegistryBackupImportFromFile: vi.fn(),
    appDeleteVrchatRegistryFolder: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRegistryBackupList: mocks.appRegistryBackupList,
        appRegistryBackupCreate: mocks.appRegistryBackupCreate,
        appRegistryBackupRestore: mocks.appRegistryBackupRestore,
        appRegistryBackupDelete: mocks.appRegistryBackupDelete,
        appRegistryBackupExportToFile: mocks.appRegistryBackupExportToFile,
        appRegistryBackupImportFromFile: mocks.appRegistryBackupImportFromFile,
        appDeleteVrchatRegistryFolder: mocks.appDeleteVrchatRegistryFolder
    }
}));

vi.mock('./hostCapabilityService', () => ({
    requireHostCapability: mocks.requireHostCapability
}));

import {
    backupVrcRegistry,
    deleteVrcRegistryBackup,
    deleteVrcRegistryFolder,
    listVrcRegistryBackups,
    restoreVrcRegistryBackup,
    restoreVrcRegistryBackupFromFile,
    saveVrcRegistryBackupToFile
} from './registryBackupService';

const commandMocks = [
    mocks.appRegistryBackupList,
    mocks.appRegistryBackupCreate,
    mocks.appRegistryBackupRestore,
    mocks.appRegistryBackupDelete,
    mocks.appRegistryBackupExportToFile,
    mocks.appRegistryBackupImportFromFile,
    mocks.appDeleteVrchatRegistryFolder
];

const backup = {
    key: 'backup-key',
    name: 'Before update',
    date: '2026-07-15T12:00:00Z'
};

describe('registryBackupService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.appRegistryBackupList.mockResolvedValue([backup]);
        mocks.appRegistryBackupCreate.mockResolvedValue([backup]);
        mocks.appRegistryBackupRestore.mockResolvedValue(backup);
        mocks.appRegistryBackupDelete.mockResolvedValue([]);
        mocks.appRegistryBackupExportToFile.mockResolvedValue(
            'C:/Temp/backup.json'
        );
        mocks.appRegistryBackupImportFromFile.mockResolvedValue(true);
        mocks.appDeleteVrchatRegistryFolder.mockResolvedValue(null);
    });

    it.each([
        ['list', () => listVrcRegistryBackups()],
        ['create', () => backupVrcRegistry('Named backup')],
        ['restore', () => restoreVrcRegistryBackup('backup-key')],
        ['delete', () => deleteVrcRegistryBackup('backup-key')],
        ['save', () => saveVrcRegistryBackupToFile('backup-key')],
        ['import', () => restoreVrcRegistryBackupFromFile()],
        ['delete registry folder', () => deleteVrcRegistryFolder()]
    ])('checks registryPrefs before %s IPC', async (_name, invoke) => {
        mocks.requireHostCapability.mockImplementationOnce(() => {
            throw new Error('registry unavailable');
        });

        await expect(invoke()).rejects.toThrow('registry unavailable');

        expect(mocks.requireHostCapability).toHaveBeenCalledWith(
            'registryPrefs'
        );
        for (const command of commandMocks) {
            expect(command).not.toHaveBeenCalled();
        }
    });

    it('passes list, create, restore, and delete through to their commands', async () => {
        await expect(listVrcRegistryBackups()).resolves.toEqual([backup]);
        await expect(backupVrcRegistry('Named backup')).resolves.toEqual([
            backup
        ]);
        await expect(restoreVrcRegistryBackup('restore-key')).resolves.toBe(
            backup
        );
        await expect(deleteVrcRegistryBackup('delete-key')).resolves.toEqual(
            []
        );

        expect(mocks.appRegistryBackupList).toHaveBeenCalledWith();
        expect(mocks.appRegistryBackupCreate).toHaveBeenCalledWith(
            'Named backup'
        );
        expect(mocks.appRegistryBackupRestore).toHaveBeenCalledWith(
            'restore-key'
        );
        expect(mocks.appRegistryBackupDelete).toHaveBeenCalledWith(
            'delete-key'
        );
    });

    it('forwards a missing-backup error from the file export action', async () => {
        mocks.appRegistryBackupExportToFile.mockRejectedValueOnce(
            new Error('Registry backup not found.')
        );

        await expect(
            saveVrcRegistryBackupToFile('missing-key')
        ).rejects.toThrow('Registry backup not found.');

        expect(mocks.appRegistryBackupExportToFile).toHaveBeenCalledWith(
            'missing-key'
        );
    });

    it('exports a backup through one file action IPC', async () => {
        await expect(saveVrcRegistryBackupToFile('backup-key')).resolves.toBe(
            'C:/Temp/backup.json'
        );

        expect(mocks.appRegistryBackupExportToFile).toHaveBeenCalledWith(
            'backup-key'
        );
    });

    it('returns false when file selection is cancelled', async () => {
        mocks.appRegistryBackupImportFromFile.mockResolvedValueOnce(false);

        await expect(restoreVrcRegistryBackupFromFile()).resolves.toBe(false);

        expect(mocks.appRegistryBackupImportFromFile).toHaveBeenCalledWith();
    });

    it('imports a registry backup through one file action IPC', async () => {
        await expect(restoreVrcRegistryBackupFromFile()).resolves.toBe(true);

        expect(mocks.appRegistryBackupImportFromFile).toHaveBeenCalledWith();
    });

    it('deletes the VRChat registry folder', async () => {
        await expect(deleteVrcRegistryFolder()).resolves.toBeNull();

        expect(mocks.appDeleteVrchatRegistryFolder).toHaveBeenCalledWith();
    });
});
