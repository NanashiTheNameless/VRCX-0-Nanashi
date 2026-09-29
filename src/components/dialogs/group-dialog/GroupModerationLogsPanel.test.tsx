import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/dateTime', () => ({
    formatDateFilter: (value: string) => `formatted:${value}`
}));

vi.mock('@/components/Location', async () => {
    const React = await import('react');

    return {
        Location: ({ location }: { location?: string }) =>
            React.createElement('span', { 'data-location': location }, location)
    };
});

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    type ButtonProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Button: ({ children, ...props }: ButtonProps) =>
            React.createElement('button', props, children)
    };
});

import type { AppCellContext } from '@/components/data-table/appTable';
import { openUserDialog } from '@/services/dialogService';

import {
    createGroupAuditLogColumns,
    filterGroupAuditLogs,
    formatGroupAuditLogTypeName,
    type GroupModerationLogRow,
    openGroupAuditLogActor,
    toggleGroupAuditLogType
} from './GroupModerationLogsPanel';

describe('GroupModerationLogsPanel', () => {
    const row = {
        id: 'log_1',
        actorDisplayName: 'Moderator Alice',
        actorId: 'usr_actor',
        created_at: '2026-06-29T10:00:00Z',
        data: {
            reason: 'spam'
        },
        description: 'Banned Bob from the group',
        eventType: 'group.member.ban',
        targetId: 'wrld_target'
    };

    it('formats audit log type names for the filter menu', () => {
        expect(formatGroupAuditLogTypeName('group.member.ban')).toBe(
            'Member Ban'
        );
        expect(formatGroupAuditLogTypeName('')).toBe('');
    });

    it('toggles audit log event type selections without reordering survivors', () => {
        expect(
            toggleGroupAuditLogType(['group.member.ban'], 'group.member.kick')
        ).toEqual(['group.member.ban', 'group.member.kick']);
        expect(
            toggleGroupAuditLogType(['group.member.ban'], 'group.member.ban')
        ).toEqual([]);
    });

    it('filters logs by description only', () => {
        expect(filterGroupAuditLogs([row], 'banned')).toEqual([row]);
        expect(filterGroupAuditLogs([row], 'Moderator Alice')).toEqual([]);
    });

    it('opens the actor user dialog from the log row actor fields and skips rows without an actor', () => {
        vi.mocked(openUserDialog).mockClear();

        openGroupAuditLogActor(row);

        expect(openUserDialog).toHaveBeenCalledWith({
            seedData: {
                displayName: 'Moderator Alice',
                id: 'usr_actor'
            },
            title: 'Moderator Alice',
            userId: 'usr_actor'
        });

        vi.mocked(openUserDialog).mockClear();

        openGroupAuditLogActor({ ...row, actorId: '  ' });

        expect(openUserDialog).not.toHaveBeenCalled();
    });

    it('renders dedicated log columns including target location and raw data', () => {
        const columns = createGroupAuditLogColumns((key: string) => key);
        const html = columns
            .map((column) => {
                const cell = column.cell;
                if (typeof cell !== 'function') {
                    return '';
                }
                return renderToStaticMarkup(
                    React.createElement(
                        React.Fragment,
                        null,
                        cell({
                            row: { original: row }
                        } as unknown as AppCellContext<GroupModerationLogRow>)
                    )
                );
            })
            .join('');

        expect(html).toContain('formatted:2026-06-29T10:00:00Z');
        expect(html).toContain('Member Ban');
        expect(html).toContain('Moderator Alice');
        expect(html).toContain('Banned Bob from the group');
        expect(html).toContain('&quot;reason&quot;:&quot;spam&quot;');
        expect(html).toContain('data-location="wrld_target"');
    });
});
