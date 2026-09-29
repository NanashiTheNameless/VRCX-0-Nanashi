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

import { GROUP_PROFILE_MEDIA_SECTIONS } from './group-dialog/groupDialogUtils';
import { ProfileMediaPanel } from './ProfileMediaPanel';
import { USER_PROFILE_MEDIA_SECTIONS } from './user-dialog/userProfileFields';

function mediaFile(id: string) {
    return { id, name: id, versions: [] };
}

describe('ProfileMediaPanel', () => {
    afterEach(cleanup);

    it('lets the current user clear their banner and profile icon', async () => {
        mocks.getFileList.mockResolvedValue({ json: [] });
        const onSetField = vi.fn();
        render(
            <ProfileMediaPanel
                title="dialog.user.actions.edit_profile_media"
                sections={USER_PROFILE_MEDIA_SECTIONS}
                currentFileIds={{
                    banner: 'file_banner',
                    userIcon: 'file_icon'
                }}
                actionStatus="idle"
                onBack={vi.fn()}
                onSetField={onSetField}
            />
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.gallery_icons.clear_banner'
            })
        );
        await waitFor(() =>
            expect(onSetField).toHaveBeenCalledWith('banner', '')
        );
        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.gallery_icons.clear_profile_icon'
            })
        );
        await waitFor(() =>
            expect(onSetField).toHaveBeenCalledWith('userIcon', '')
        );
    });

    it('applies a picked group icon from the VRC+ icons and offers no clearing', async () => {
        mocks.getFileList.mockImplementation(({ tag }: { tag: string }) =>
            Promise.resolve({
                json: tag === 'icon' ? [mediaFile('file_new_icon')] : []
            })
        );
        const onSetField = vi.fn();
        render(
            <ProfileMediaPanel
                title="dialog.user.actions.edit_profile_media"
                sections={GROUP_PROFILE_MEDIA_SECTIONS}
                currentFileIds={{ bannerId: '', iconId: 'file_old_icon' }}
                actionStatus="idle"
                onBack={vi.fn()}
                onSetField={onSetField}
            />
        );

        fireEvent.click(
            await screen.findByTitle(
                'dialog.group.actions.use_group_icon: file_new_icon'
            )
        );
        await waitFor(() =>
            expect(onSetField).toHaveBeenCalledWith('iconId', 'file_new_icon')
        );
        expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    });
});
