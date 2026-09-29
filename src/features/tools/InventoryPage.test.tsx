// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InventoryItemRecord } from '@/repositories/vrchatMediaRepository';

vi.mock('./components/InventoryItemTile', () => ({
    InventoryItemTile: ({
        primaryAction
    }: {
        primaryAction?: {
            disabled?: boolean;
            label: string;
            onClick: () => void;
        } | null;
    }) =>
        primaryAction ? (
            <button
                type="button"
                disabled={primaryAction.disabled}
                onClick={primaryAction.onClick}
            >
                {primaryAction.label}
            </button>
        ) : (
            <span>no-primary-action</span>
        )
}));

import { InventoryItemCard } from './InventoryPage';

const baseItem = {
    id: 'inv_frame',
    holderId: 'usr_self',
    itemType: 'iconFrame',
    equipSlot: '',
    equipSlots: ['iconFrame'],
    flags: ['equippable']
};

function renderCard({
    item = baseItem,
    profileDecorationMutationPending = false,
    onSetProfileDecorationEquipped = vi.fn()
}: {
    item?: typeof baseItem;
    profileDecorationMutationPending?: boolean;
    onSetProfileDecorationEquipped?: (item: InventoryItemRecord) => void;
} = {}) {
    render(
        <InventoryItemCard
            item={item}
            currentUserId="usr_self"
            mutatingKey=""
            profileDecorationMutationPending={profileDecorationMutationPending}
            onPreview={vi.fn()}
            onArchive={vi.fn()}
            onConsumeBundle={vi.fn()}
            onSetProfileDecorationEquipped={onSetProfileDecorationEquipped}
        />
    );
    return onSetProfileDecorationEquipped;
}

describe('InventoryItemCard', () => {
    afterEach(cleanup);

    it('offers equip for an available owned profile decoration', () => {
        const onSetProfileDecorationEquipped = renderCard();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.inventory.equip'
            })
        );

        expect(onSetProfileDecorationEquipped).toHaveBeenCalledWith(baseItem);
    });

    it('offers unequip only when the active slot matches', () => {
        renderCard({
            item: {
                ...baseItem,
                equipSlot: 'iconFrame'
            }
        });

        expect(
            screen.getByRole('button', {
                name: 'dialog.inventory.unequip'
            })
        ).toBeTruthy();
    });

    it('disables every profile decoration action while one mutation refreshes', () => {
        renderCard({ profileDecorationMutationPending: true });

        expect(
            screen
                .getByRole('button', {
                    name: 'dialog.inventory.equip'
                })
                .hasAttribute('disabled')
        ).toBe(true);
    });
});
