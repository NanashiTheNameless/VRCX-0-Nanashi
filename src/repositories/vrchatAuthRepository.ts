import {
    commands,
    type HttpApiExecuteResponse,
    type VrchatAuthFileAnalysisInput
} from '@/platform/tauri/bindings';
import { DEFAULT_VRCHAT_API_ENDPOINT } from '@/shared/vrchatEndpoint';

import {
    type VrchatRequestResponse,
    unwrapVrchatResponse
} from './vrchatRequest';

type VrchatApiResult = HttpApiExecuteResponse;
type AuthRecord = Record<string, unknown>;

function unwrapVrchatAuthResponse<TJson = unknown>(
    response: VrchatApiResult,
    path: string
): VrchatRequestResponse<TJson> {
    return {
        ...unwrapVrchatResponse<TJson>(response, path),
        endpointDomain: DEFAULT_VRCHAT_API_ENDPOINT
    };
}

async function getConfig() {
    const response = await commands.appVrchatAuthConfigGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config');
}

async function refreshConfig() {
    const response = await commands.appVrchatAuthConfigRefresh();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'config');
}

async function getCurrentUser() {
    const response = await commands.appVrchatAuthCurrentUserGet();
    return unwrapVrchatAuthResponse<AuthRecord>(response, 'auth/user');
}

async function getOnlineVisits() {
    const response = await commands.appVrchatAuthVisitsGet();
    return unwrapVrchatAuthResponse<unknown[]>(response, 'visits');
}

async function getFileAnalysis({
    fileId,
    version,
    variant
}: VrchatAuthFileAnalysisInput) {
    const response = await commands.appVrchatAuthFileAnalysisGet({
        fileId,
        version,
        variant
    });
    return unwrapVrchatAuthResponse(
        response,
        `analysis/${encodeURIComponent(fileId ?? '')}/${version ?? 0}/${encodeURIComponent(variant ?? '')}`
    );
}

const vrchatAuthRepository = Object.freeze({
    getConfig,
    refreshConfig,
    getCurrentUser,
    getOnlineVisits,
    getFileAnalysis
});

export default vrchatAuthRepository;
