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

describe('registryBackupService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
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
});
