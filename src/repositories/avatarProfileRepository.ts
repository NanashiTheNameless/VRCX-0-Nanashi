import {
    createImposter,
    deleteAvatar,
    deleteImposter,
    saveAvatar,
    selectAvatar,
    selectFallbackAvatar
} from './avatar-profile/actions';
import { getAvatarGallery } from './avatar-profile/gallery';
import {
    deleteAvatarModeration,
    getAvatarModerations,
    sendAvatarModeration
} from './avatar-profile/moderation';
import { normalize } from './avatar-profile/normalization';
import {
    getAllAvatarsByUser,
    findAvatarByImageUrl,
    getAvatarProfile,
    getAvatarStyles,
    getAvatarsByUser
} from './avatar-profile/profile';

const avatarProfileRepository = Object.freeze({
    normalize,
    getAvatarProfile,
    findAvatarByImageUrl,
    getAvatarGallery,
    getAvatarsByUser,
    getAllAvatarsByUser,
    selectAvatar,
    selectFallbackAvatar,
    saveAvatar,
    getAvatarStyles,
    deleteAvatar,
    createImposter,
    deleteImposter,
    getAvatarModerations,
    sendAvatarModeration,
    deleteAvatarModeration
});

export type {
    AvatarGalleryFile,
    AvatarModerationRecord,
    AvatarStyleRecord
} from './avatar-profile/types';
export type {
    AvatarProfileRecord,
    AvatarStyleSelection
} from '@/domain/entities/avatar';
export default avatarProfileRepository;
