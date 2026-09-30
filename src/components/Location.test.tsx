import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Button } from '@/ui/shadcn/button';

const mocks = vi.hoisted(() => ({
    metadata: {
        currentEndpoint: 'https://api.example.test/api/1',
        region: 'jp',
        instanceName: '12345',
        isClosed: false,
        groupName: '',
        groupNamePending: false,
        worldName: 'Test World',
        worldNameHint: '',
        worldNamePending: false
    },
    preferencesState: {
        preferencesHydrated: true,
        isAgeGatedInstancesVisible: false,
        showInstanceIdInLocation: false
    }
}));

vi.mock('@/services/i18nService', () => ({
    default: { t: (key: string) => key }
}));

vi.mock('@/components/location/LocationContextMenu', async () => {
    const React = await import('react');

    return {
        LocationContextMenu: ({ children }: React.PropsWithChildren) =>
            React.createElement(React.Fragment, null, children)
    };
});

vi.mock('@/components/location/useLocationMetadata', async () => {
    const actual = await vi.importActual(
        '@/components/location/useLocationMetadata'
    );

    return {
        ...actual,
        useLocationMetadata: () => mocks.metadata
    };
});

vi.mock('@/components/location/useLocationPreviousInstancesDialog', () => ({
    useLocationPreviousInstancesDialog: () => ({
        previousInstancesLoading: false,
        showExactPreviousInstanceInfo: vi.fn(),
        showPreviousInstances: vi.fn()
    })
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: <T,>(
        selector: (state: typeof mocks.preferencesState) => T
    ) => selector(mocks.preferencesState)
}));

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
        'component.region_code_badge.dynamic.region_value': 'Region',
        'dialog.new_instance.access_type_group': 'Group',
        'dialog.new_instance.access_type_public': 'Public',
        'dialog.new_instance.instance_id': 'Instance ID',
        'dialog.user.info.instance_age_restricted': 'Age Restricted',
        'dialog.user.info.instance_age_restricted_tooltip':
            'This instance is age restricted',
        'dialog.user.info.instance_closed': 'Instance closed',
        'location.offline': 'Offline',
        'location.private': 'Private',
        'location.traveling': 'Traveling'
    };

    return {
        useTranslation: () => ({
            t: (key: string) => translations[key] || key
        })
    };
});

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({
            children,
            variant: _variant,
            ...props
        }: React.ComponentProps<'button'> &
            Pick<React.ComponentProps<typeof Button>, 'variant'>) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/spinner', async () => {
    const React = await import('react');

    return {
        Spinner: (props: React.ComponentProps<'span'>) =>
            React.createElement('span', props, 'loading')
    };
});

vi.mock('@/ui/shadcn/tooltip', async () => {
    const ReactRuntime = await import('react');
    type MockRender =
        | React.ReactNode
        | ((props: object, state: object) => React.ReactNode);
    const renderMockSlot = (
        render: MockRender | undefined,
        children: React.ReactNode
    ) => {
        if (typeof render === 'function') {
            return render({}, {});
        }
        return ReactRuntime.isValidElement(render) ? render : children;
    };

    return {
        Tooltip: ({ children }: React.PropsWithChildren) =>
            ReactRuntime.createElement(ReactRuntime.Fragment, null, children),
        TooltipTrigger: ({
            children,
            render
        }: {
            children?: React.ReactNode;
            render?: MockRender;
        }) =>
            ReactRuntime.createElement(
                ReactRuntime.Fragment,
                null,
                renderMockSlot(render, children)
            ),
        TooltipContent: ({ children }: React.PropsWithChildren) =>
            ReactRuntime.createElement(
                'span',
                { 'data-tooltip-content': true },
                children
            )
    };
});

import { Location } from './Location';

type LocationTestProps = {
    location?: string;
    traveling?: string;
    showGroupLink?: boolean;
};

function renderLocation(props: LocationTestProps = {}) {
    return renderToStaticMarkup(React.createElement(Location, props));
}

describe('Location', () => {
    beforeEach(() => {
        mocks.metadata.currentEndpoint = 'https://api.example.test/api/1';
        mocks.metadata.region = 'jp';
        mocks.metadata.instanceName = '12345';
        mocks.metadata.isClosed = false;
        mocks.metadata.groupName = '';
        mocks.metadata.groupNamePending = false;
        mocks.metadata.worldName = 'Test World';
        mocks.metadata.worldNameHint = '';
        mocks.metadata.worldNamePending = false;
        mocks.preferencesState.preferencesHydrated = true;
        mocks.preferencesState.isAgeGatedInstancesVisible = false;
        mocks.preferencesState.showInstanceIdInLocation = false;
    });

    it('renders a world instance with region, access type, group, and instance id', () => {
        mocks.metadata.groupName = 'Group Alpha';
        mocks.preferencesState.showInstanceIdInLocation = true;

        const html = renderLocation({
            location: 'wrld_test:12345~region(jp)~group(grp_test)',
            showGroupLink: true
        });

        expect(html).toContain('JP');
        expect(html).toContain('Test World · Group');
        expect(html).toContain('· #12345');
        expect(html).toContain('(Group Alpha)');
    });

    it('hides age gated instance details until the preference allows them', () => {
        const html = renderLocation({
            location: 'wrld_test:12345~ageGate'
        });

        expect(html).toContain('Age Restricted');
        expect(html).not.toContain('Test World · Public');
    });

    it('uses the traveling target while preserving the traveling indicator', () => {
        const html = renderLocation({
            location: 'traveling',
            traveling: 'wrld_test:12345~region(jp)'
        });

        expect(html).toContain('loading');
        expect(html).toContain('Test World · Public');
    });

    it('shows a placeholder instead of the raw world id while the name is pending', () => {
        mocks.metadata.worldName = '';
        mocks.metadata.worldNamePending = true;

        const html = renderLocation({
            location: 'wrld_test:12345~region(jp)'
        });

        expect(html).toContain('data-slot="location-pending"');
        expect(html).not.toContain('wrld_test');
    });

    it('shows the world name with a group placeholder while the group is pending', () => {
        mocks.metadata.groupNamePending = true;

        const html = renderLocation({
            location: 'wrld_test:12345~region(jp)~group(grp_test)',
            showGroupLink: true
        });

        expect(html).toContain('Test World · Group');
        expect(html).toContain('data-slot="location-pending"');
        expect(html).not.toContain('grp_test');
    });

    it('falls back to the raw world id once the lookup settles without a name', () => {
        mocks.metadata.worldName = '';

        const html = renderLocation({
            location: 'wrld_test:12345~region(jp)'
        });

        expect(html).not.toContain('data-slot="location-pending"');
        expect(html).toContain('wrld_test · Public');
    });

    it('renders sentinel location labels without world metadata', () => {
        expect(renderLocation({ location: 'offline' })).toContain('Offline');
        expect(renderLocation({ location: 'private' })).toContain('Private');
    });
});
