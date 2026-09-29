import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    isEquippedProfileDecoration,
    resolveInventoryDescription,
    resolveInventoryImageUrl,
    resolveInventoryName,
    resolveInventoryType,
    resolveProfileDecorationMutation,
    resolveProfileDecorationPreviewUrl,
    resolveProfileDecorationTypeLabelKey
} from '@/domain/entities/inventory';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/shared/constants/imageUpload';

import {
    buildEmojiUploadParams,
    CATEGORY_DEFINITIONS,
    getLatestFileUrl,
    getUsefulDisplayName,
    parseEmojiUploadSettings,
    validateImageFile
} from './inventoryHelpers';

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

const { toast } = await import('@/services/toastService');

describe('inventory helpers', () => {
    it('builds mutually exclusive static and animated emoji params', () => {
        expect(
            buildEmojiUploadParams({
                isAnimated: false,
                animationStyle: 'Stop',
                fps: 0,
                frames: 1,
                loopPingPong: true
            })
        ).toEqual({
            tag: 'emoji',
            animationStyle: 'stop',
            maskTag: 'square'
        });
        expect(
            buildEmojiUploadParams({
                isAnimated: true,
                animationStyle: 'Bounce',
                fps: 65,
                frames: 1,
                loopPingPong: true
            })
        ).toEqual({
            tag: 'emojianimated',
            animationStyle: 'bounce',
            maskTag: 'square',
            frames: 2,
            framesOverTime: 64,
            loopStyle: 'pingpong'
        });
    });
    beforeEach(() => {
        vi.mocked(toast.add).mockClear();
    });

    it('parses emoji upload settings from filename tokens and clamps numeric bounds', () => {
        expect(
            parseEmojiUploadSettings(
                'avatar_BounceanimationStyle_99frames_0fps_pingpongloopStyle.png',
                {
                    isAnimated: false,
                    animationStyle: 'Stop',
                    fps: 15,
                    frames: 4,
                    loopPingPong: false
                }
            )
        ).toEqual({
            isAnimated: true,
            animationStyle: 'Bounce',
            fps: 1,
            frames: 64,
            loopPingPong: true
        });
    });

    it('keeps current emoji defaults when filename tokens are missing or invalid', () => {
        expect(
            parseEmojiUploadSettings('plain-upload.png', {
                isAnimated: true,
                animationStyle: 'Wave',
                fps: 24,
                frames: 8,
                loopPingPong: true
            })
        ).toEqual({
            isAnimated: true,
            animationStyle: 'Wave',
            fps: 24,
            frames: 8,
            loopPingPong: true
        });
    });

    it('accepts supported images below the 20 MB limit', () => {
        const file = new Blob(['image'], { type: 'image/png' });

        expect(validateImageFile(file, (key: string) => key)).toBe(true);
        expect(toast.add).not.toHaveBeenCalled();
    });

    it('rejects files at the 20 MB limit and non-image file types with localized toast keys', () => {
        const tooLarge = new Blob([new Uint8Array(MAX_IMAGE_UPLOAD_BYTES)], {
            type: 'image/png'
        });
        const textFile = new Blob(['not image'], { type: 'text/plain' });

        expect(validateImageFile(tooLarge, (key: string) => key)).toBe(false);
        expect(validateImageFile(textFile, (key: string) => key)).toBe(false);
        expect(toast.add).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                type: 'error',
                title: 'message.file.too_large'
            })
        );
        expect(toast.add).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                type: 'error',
                title: 'message.file.not_image'
            })
        );
    });

    it('resolves inventory display fallbacks from nested item, template, and metadata fields', () => {
        const item = {
            id: 'inv_1',
            item: {
                name: 'Nested Item',
                description: 'Nested description',
                type: 'sticker',
                thumbnailUrl: 'https://example.test/item-thumb.png'
            },
            template: {
                name: 'Template Name',
                description: 'Template description',
                imageUrl: 'https://example.test/template.png'
            },
            metadata: {
                imageUrl: 'https://example.test/metadata.png'
            }
        };

        expect(resolveInventoryName(item)).toBe('Nested Item');
        expect(resolveInventoryDescription(item)).toBe('Nested description');
        expect(resolveInventoryType(item)).toBe('sticker');
        expect(resolveInventoryImageUrl(item)).toBe(
            'https://example.test/item-thumb.png'
        );
    });

    it('resolves latest file urls and hides generated file blob names', () => {
        expect(
            getLatestFileUrl({
                versions: [
                    { file: { url: 'https://example.test/old.png' } },
                    { file: { url: 'https://example.test/new.png' } }
                ]
            })
        ).toBe('https://example.test/new.png');

        expect(
            getUsefulDisplayName({
                id: 'file_123',
                displayName: 'file_123_blob',
                name: 'Readable Name'
            })
        ).toBe('');
        expect(
            getUsefulDisplayName({
                id: 'file_123',
                displayName: '',
                name: 'Readable Name'
            })
        ).toBe('Readable Name');
    });

    it('archives every profile decoration item type', () => {
        const profileDecorations = CATEGORY_DEFINITIONS.cosmetics.tabs.find(
            (tab: { key: string }) => tab.key === 'profile-decorations'
        );
        const archived = CATEGORY_DEFINITIONS.cosmetics.tabs.find(
            (tab: { key: string }) => tab.key === 'archived'
        );
        const decorationTypes = profileDecorations?.params.types;
        if (!archived || !decorationTypes?.length) {
            throw new Error('Expected profile decorations and archived tabs');
        }

        expect(archived.params.types).toEqual(
            expect.arrayContaining(decorationTypes)
        );
    });

    it('resolves equip and unequip from the owned active slot', () => {
        const item = {
            id: 'inv_frame',
            holderId: 'usr_self',
            itemType: 'iconFrame',
            equipSlot: '',
            equipSlots: ['iconFrame'],
            flags: ['equippable']
        };

        expect(resolveProfileDecorationMutation(item, 'usr_self')).toEqual({
            action: 'equip',
            equipSlot: 'iconFrame',
            inventoryId: 'inv_frame'
        });
        expect(
            resolveProfileDecorationMutation(
                {
                    ...item,
                    equipSlot: 'iconFrame',
                    last_equipped: {
                        iconFrame: '2026-07-26T15:12:39.373Z'
                    }
                },
                'usr_self'
            )
        ).toEqual({
            action: 'unequip',
            equipSlot: 'iconFrame',
            inventoryId: 'inv_frame'
        });
    });

    it('rejects decorations that are not safe to mutate', () => {
        const validItem = {
            id: 'inv_frame',
            holderId: 'usr_self',
            itemType: 'iconFrame',
            equipSlot: '',
            equipSlots: ['iconFrame'],
            flags: ['equippable']
        };

        for (const item of [
            { ...validItem, id: 'invt_frame' },
            { ...validItem, holderId: 'usr_other' },
            { ...validItem, itemType: 'droneskin' },
            { ...validItem, equipSlots: [] },
            { ...validItem, flags: [] },
            { ...validItem, isArchived: true }
        ]) {
            expect(
                resolveProfileDecorationMutation(item, 'usr_self')
            ).toBeNull();
        }
        expect(resolveProfileDecorationMutation(validItem, '')).toBeNull();
    });

    it('uses the active equipment slot instead of equipment history', () => {
        expect(
            isEquippedProfileDecoration({
                id: 'inv_history',
                itemType: 'iconFrame',
                equipSlot: '',
                last_equipped: {
                    iconFrame: '2026-07-26T15:12:39.373Z'
                }
            })
        ).toBe(false);
        expect(
            isEquippedProfileDecoration({
                id: 'inv_equipped',
                itemType: 'profileEffect',
                equipSlot: 'profileEffect'
            })
        ).toBe(true);
        expect(
            isEquippedProfileDecoration({
                id: 'inv_other_slot',
                itemType: 'nameplateEffect',
                equipSlot: 'profileEffect'
            })
        ).toBe(false);
    });

    it('resolves profile decoration previews from animation assets before fallbacks', () => {
        const item = {
            id: 'inv_effect',
            imageUrl: 'https://example.test/thumbnail.png',
            metadata: {
                assets: [
                    {
                        type: 'base',
                        url: 'https://example.test/base.png'
                    },
                    {
                        type: 'introAnimation',
                        url: 'https://example.test/intro.webp'
                    },
                    {
                        type: 'mainAnimation',
                        url: 'https://example.test/main.webp'
                    }
                ]
            }
        };

        expect(resolveProfileDecorationPreviewUrl(item)).toBe(
            'https://example.test/main.webp'
        );
        expect(
            resolveProfileDecorationPreviewUrl({
                ...item,
                metadata: {
                    assets: item.metadata.assets.filter(
                        (asset) => asset.type !== 'mainAnimation'
                    )
                }
            })
        ).toBe('https://example.test/intro.webp');
        expect(
            resolveProfileDecorationPreviewUrl({
                ...item,
                metadata: {
                    assets: item.metadata.assets.filter(
                        (asset) => asset.type === 'base'
                    )
                }
            })
        ).toBe('https://example.test/base.png');
        expect(
            resolveProfileDecorationPreviewUrl({
                id: 'inv_fallback',
                imageUrl: 'https://example.test/thumbnail.png',
                metadata: { assets: [{ type: 'mainAnimation', url: '' }] }
            })
        ).toBe('https://example.test/thumbnail.png');
        expect(
            resolveProfileDecorationPreviewUrl({ id: 'inv_without_media' })
        ).toBe('');
    });

    it('has no profile decoration label for other item types', () => {
        expect(resolveProfileDecorationTypeLabelKey('portalskin')).toBeNull();
    });
});
