import { describe, expect, it } from 'vitest';

import { resolveProxyIndicatorState } from './statusBarProxy';

describe('statusBarProxy', () => {
    it('resolves a disabled proxy to the disabled tone', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: false,
                server: '127.0.0.1:7890',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'disabled',
            tooltipKey: 'status_bar.proxy_disabled'
        });
    });

    it('resolves an enabled proxy without a server to the direct tone', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'direct',
            tooltipKey: 'status_bar.proxy_enabled_direct'
        });
    });

    it('resolves an enabled proxy with a trimmed server to the enabled tone', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '  127.0.0.1:7890  ',
                hasNetworkIssue: false
            })
        ).toMatchObject({
            tone: 'enabled',
            tooltipKey: 'status_bar.proxy_enabled_server',
            tooltipValues: {
                proxy: '127.0.0.1:7890'
            }
        });
    });

    it('resolves an enabled proxy with a network issue to the warning tone', () => {
        expect(
            resolveProxyIndicatorState({
                enabled: true,
                server: '127.0.0.1:7890',
                hasNetworkIssue: true
            })
        ).toMatchObject({
            tone: 'warning',
            tooltipKey: 'status_bar.proxy_network_issue'
        });
    });
});
