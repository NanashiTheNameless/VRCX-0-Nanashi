// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFileList: vi.fn()
}));
vi.mock('@/repositories/vrchatMediaRepository', () => ({
    default: { getFileList: mocks.getFileList }
}));

import { UserProfileMediaPicker } from './UserProfileMediaPicker';

function mediaFile(id: string, createdAt: string, tags: string[]) {
    return { id, tags, versions: [{ created_at: createdAt }] };
}

afterEach(cleanup);

describe('UserProfileMediaPicker', () => {
    it('locks uploaded icons without VRC+ but keeps camera icons usable', async () => {
        mocks.getFileList.mockResolvedValue({
            json: [
                mediaFile('file_upload', '2025-01-01T00:00:00Z', ['icon']),
                mediaFile('file_camera', '2026-10-20T00:00:00Z', [
                    'cameraIcon',
                    'icon'
                ])
            ]
        });
        const onSetFile = vi.fn().mockResolvedValue(undefined);
        render(
            <UserProfileMediaPicker
                field="userIcon"
                profile={{ id: 'usr_self', userIcon: '' }}
                isVrcPlus={false}
                busy={false}
                onSetFile={onSetFile}
                onSetBannerColor={vi.fn()}
            />
        );

        expect(
            await screen.findByText('dialog.gallery_icons.locked_title')
        ).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.inventory.requires_vrc_plus'
            })
        );
        expect(onSetFile).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.gallery_icons.use_profile_icon'
            })
        );
        await waitFor(() =>
            expect(onSetFile).toHaveBeenCalledWith('userIcon', 'file_camera')
        );
    });

    it('switches a color banner to the avatar image or a new color', async () => {
        mocks.getFileList.mockResolvedValue({ json: [] });
        const onSetFile = vi.fn().mockResolvedValue(undefined);
        const onSetBannerColor = vi.fn().mockResolvedValue(undefined);
        const { container } = render(
            <UserProfileMediaPicker
                field="banner"
                profile={{
                    id: 'usr_self',
                    bannerType: 'color',
                    bannerColor: 'a9d96a',
                    bannerCustomUrl: ''
                }}
                isVrcPlus={false}
                busy={false}
                onSetFile={onSetFile}
                onSetBannerColor={onSetBannerColor}
            />
        );

        const colorInput = container.querySelector('input[type="color"]');
        if (!(colorInput instanceof HTMLInputElement)) {
            throw new Error('Expected the banner color input');
        }
        fireEvent.change(colorInput, { target: { value: '#891454' } });
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.user.profile_edit.apply_color'
            })
        );
        await waitFor(() =>
            expect(onSetBannerColor).toHaveBeenCalledWith('#891454')
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.user.profile_edit.avatar_image'
            })
        );
        await waitFor(() =>
            expect(onSetFile).toHaveBeenCalledWith('banner', '')
        );
        expect(
            screen.queryByText('dialog.gallery_icons.locked_title')
        ).toBeNull();
    });
});
