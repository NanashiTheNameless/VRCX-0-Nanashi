// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createInstance: vi.fn(),
    resolveCreatedInstanceDetails: vi.fn(),
    selfInviteToInstance: vi.fn(),
    tryOpenLaunchLocation: vi.fn(),
    showLaunchDialog: vi.fn(),
    loadNewInstanceGroups: vi.fn().mockResolvedValue([])
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        setString: vi.fn().mockResolvedValue(undefined),
        setBool: vi.fn().mockResolvedValue(undefined),
        getString: vi.fn().mockResolvedValue(''),
        getBool: vi.fn().mockResolvedValue(false),
        getArray: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('@/repositories/vrchatInstanceRepository', () => ({
    default: { createInstance: mocks.createInstance }
}));

vi.mock('@/services/launchService', () => ({
    selfInviteToInstance: mocks.selfInviteToInstance
}));

vi.mock('@/services/directAccessService', () => ({
    tryOpenLaunchLocation: mocks.tryOpenLaunchLocation
}));

vi.mock('./worldInstanceResolver', () => ({
    resolveCreatedInstanceDetails: mocks.resolveCreatedInstanceDetails
}));

import configRepository from '@/repositories/configRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';

import {
    resolveNewInstanceAfterCreateAction,
    useWorldInstanceActions
} from './useWorldInstanceActions';
import { normalizeMinimumAvatarPerformance } from './worldDialogHelpers';
import type {
    NewInstanceAfterCreateAction,
    WorldNewInstanceForm
} from './worldNewInstanceTypes';

describe('useWorldInstanceActions helpers', () => {
    it('maps the follow-up new-instance action to open in-game while VRChat is running', () => {
        expect(resolveNewInstanceAfterCreateAction(true, true)).toBe(
            'openInGame'
        );
    });

    it('keeps the follow-up new-instance action as self-invite when VRChat is not running', () => {
        expect(resolveNewInstanceAfterCreateAction(true, false)).toBe(
            'selfInvite'
        );
    });

    it('does not attach a follow-up action for a plain new instance', () => {
        expect(resolveNewInstanceAfterCreateAction(false, true)).toBe('');
    });

    it('accepts API avatar-performance values and treats legacy None as no limit', () => {
        expect(normalizeMinimumAvatarPerformance('Medium')).toBe('Medium');
        expect(normalizeMinimumAvatarPerformance('None')).toBe('');
    });
});

const created = {
    location: 'wrld_test:12345',
    shortName: 'shrt',
    secureOrShortName: 'shrt',
    url: 'https://vrchat.com/home/launch?worldId=wrld_test',
    accessType: 'public',
    ownerId: 'usr_self',
    groupId: '',
    group: null
};

function renderCreateFlow(
    afterCreateAction: NewInstanceAfterCreateAction,
    isGameRunning = false
) {
    const actionStatusRef = { current: 'idle' };
    const { result } = renderHook(() =>
        useWorldInstanceActions({
            world: worldProfileRepository.normalize({
                id: 'wrld_test',
                name: 'Test World'
            }),
            currentEndpoint: 'endpoint-a',
            currentUserId: 'usr_self',
            isGameRunning,
            profileWorldId: 'wrld_test',
            newInstanceGroups: [],
            loadNewInstanceGroups: mocks.loadNewInstanceGroups,
            actionStatusRef,
            setActionStatus: vi.fn(),
            isCurrentWorldTarget: () => true,
            showLaunchDialog: mocks.showLaunchDialog
        })
    );
    act(() => {
        result.current.setNewInstanceRequest({
            selfInvite: afterCreateAction === 'selfInvite',
            afterCreateAction,
            defaults: {}
        });
    });
    return result;
}

async function submit(
    result: { current: ReturnType<typeof useWorldInstanceActions> },
    overrides: Partial<WorldNewInstanceForm> = {}
) {
    await act(async () => {
        await result.current.createWorldInstance({
            selectedTab: 'Normal',
            accessType: 'public',
            region: 'US West',
            groupId: '',
            groupAccessType: 'plus',
            minimumAvatarPerformance: '',
            queueEnabled: true,
            ageGate: false,
            displayName: '',
            displayNamePresets: [],
            roleIds: '',
            instanceName: '',
            legacyUserId: '',
            strict: false,
            ...overrides
        });
    });
}

describe('useWorldInstanceActions createWorldInstance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createInstance.mockResolvedValue({
            json: { location: created.location }
        });
        mocks.resolveCreatedInstanceDetails.mockResolvedValue(created);
        mocks.selfInviteToInstance.mockResolvedValue(undefined);
        mocks.tryOpenLaunchLocation.mockResolvedValue(true);
    });

    it('loads current-user groups when opening the new-instance dialog', async () => {
        const result = renderCreateFlow('');
        act(() => {
            result.current.setNewInstanceRequest(null);
        });

        await act(async () => {
            await result.current.openNewInstanceDialog();
        });

        expect(mocks.loadNewInstanceGroups).toHaveBeenCalledOnce();
        expect(result.current.newInstanceRequest).not.toBeNull();
    });

    it('closes the dialog and hands a plain new instance to the launch dialog', async () => {
        const result = renderCreateFlow('');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledWith(
            created.location,
            created.shortName,
            created.secureOrShortName,
            expect.objectContaining({ createdInstance: created })
        );
    });

    it('persists and forwards the group avatar-performance limit', async () => {
        const result = renderCreateFlow('');
        await submit(result, {
            accessType: 'group',
            groupId: 'grp_test',
            minimumAvatarPerformance: 'Good'
        });

        expect(configRepository.setString).toHaveBeenCalledWith(
            'instanceDialogMinimumAvatarPerformance',
            'Good'
        );
        expect(mocks.createInstance).toHaveBeenCalledWith(
            expect.objectContaining({ minimumAvatarPerformance: 'Good' })
        );
    });

    it('closes the dialog without the launch dialog when the follow-up self-invite succeeds', async () => {
        const result = renderCreateFlow('selfInvite');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.selfInviteToInstance).toHaveBeenCalledOnce();
        expect(mocks.showLaunchDialog).not.toHaveBeenCalled();
    });

    it('falls back to the launch dialog when the follow-up self-invite fails', async () => {
        mocks.selfInviteToInstance.mockRejectedValue(new Error('nope'));
        const result = renderCreateFlow('selfInvite');
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledOnce();
    });

    it('closes the dialog without the launch dialog when the follow-up open in-game succeeds', async () => {
        const result = renderCreateFlow('openInGame', true);
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.tryOpenLaunchLocation).toHaveBeenCalledOnce();
        expect(mocks.showLaunchDialog).not.toHaveBeenCalled();
    });

    it('falls back to the launch dialog when the follow-up open in-game fails', async () => {
        mocks.tryOpenLaunchLocation.mockRejectedValue(new Error('nope'));
        const result = renderCreateFlow('openInGame', true);
        await submit(result);

        expect(result.current.newInstanceRequest).toBeNull();
        expect(mocks.showLaunchDialog).toHaveBeenCalledOnce();
    });
});
