import type { ParsedLocation } from '@/shared/utils/location';

export type LocationMetadata = {
    currentEndpoint: string;
    region: string;
    instanceName: string;
    isClosed: boolean;
    groupName: string;
    groupNamePending: boolean;
    worldName: string;
    worldNameHint: string;
    worldNamePending: boolean;
};

export type LocationMetadataEntry = {
    key?: string;
    locationInfo?: ParsedLocation;
    currentLocation?: string;
    hint?: string;
    worldNameHint?: string;
    groupHint?: string;
    instanceName?: string;
};

export type NormalizedLocationMetadataEntry = {
    key: string;
    locationInfo: ParsedLocation;
    currentLocation: string;
    locationTag: string;
    locationValue: string;
    worldId: string;
    groupId: string;
    hint: string;
    worldNameHint: string;
    groupHint: string;
    instanceName: string;
};

export type LocationCacheRecord = Record<string, unknown> & {
    $location?: LocationCacheRecord | null;
    closedAt?: string | null;
    closed_at?: string | null;
    displayName?: string | null;
    group?: LocationCacheRecord | null;
    groupName?: string | null;
    group_name?: string | null;
    isClosed?: boolean;
    instanceDisplayName?: string | null;
    location?: string | null;
    name?: string | null;
    ref?: LocationCacheRecord | null;
    tag?: string | null;
    world?: LocationCacheRecord | null;
    worldName?: string | null;
    world_name?: string | null;
};

export type LocationGroupProfile = Record<string, unknown> & {
    displayName?: string;
    name?: string;
    shortCode?: string;
};

export type LocationWorldProfile = Record<string, unknown> & {
    name?: string;
};

export type LocationHintRecord = {
    groupName?: string;
    instanceName?: string;
    isClosed?: boolean;
    region?: string;
    worldName?: string;
};

export type MetadataContext = {
    cachedInstances: Map<string, LocationCacheRecord>;
    currentEndpoint: string;
    groupProfilesById: Map<string, LocationGroupProfile>;
    pendingGroupIds: Set<string>;
    locationHintsByKey: Record<string, LocationHintRecord | undefined>;
    localWorldNamesById: Map<string, string>;
    settledLocalWorldIds: Set<string>;
    settledWorldProfileIds: Set<string>;
    worldProfilesById: Map<string, LocationWorldProfile>;
};
