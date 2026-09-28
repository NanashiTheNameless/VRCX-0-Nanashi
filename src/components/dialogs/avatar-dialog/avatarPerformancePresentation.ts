import type { TFunction } from 'i18next';

import type { AvatarStatsRecord } from '@/domain/entities/world';
import type { PerformancePlatform } from '@/shared/constants/avatarPerformance';

export function performanceDocsUrl(platform: PerformancePlatform) {
    return `https://creators.vrchat.com/avatars/avatar-performance-ranking-system/#${platform === 'pc' ? 'pc' : 'mobile'}-limits`;
}

export function performanceRankClass(rank: string | undefined) {
    switch (rank) {
        case 'Excellent':
        case 'Good':
            return 'text-green-700 dark:text-green-400';
        case 'Medium':
            return 'text-amber-700 dark:text-amber-400';
        case 'Poor':
            return 'text-orange-700 dark:text-orange-400';
        case 'VeryPoor':
            return 'text-red-700 dark:text-red-400';
        default:
            return 'text-muted-foreground';
    }
}

export function performanceRankFillClass(rank: string | undefined) {
    switch (rank) {
        case 'Excellent':
        case 'Good':
            return 'bg-muted-foreground/40';
        case 'Medium':
            return 'bg-amber-600 dark:bg-amber-500';
        case 'Poor':
            return 'bg-orange-600 dark:bg-orange-500';
        case 'VeryPoor':
            return 'bg-red-600 dark:bg-red-500';
        default:
            return 'bg-muted';
    }
}

export const EMPTY_VALUE = '-';

export type PerformanceStat = {
    key: keyof AvatarStatsRecord;
    label: string;
    format?: 'boolean' | 'bounds';
    unit?: string;
};

type PerformanceStatGroup = {
    label: string;
    stats: PerformanceStat[];
};

export const TRIANGLE_STAT: PerformanceStat = {
    key: 'totalPolygons',
    label: 'triangles'
};

export const PERFORMANCE_STAT_GROUPS: PerformanceStatGroup[] = [
    {
        label: 'geometry',
        stats: [
            { key: 'bounds', label: 'bounds', format: 'bounds', unit: 'm' },
            { key: 'skinnedMeshCount', label: 'skinned_meshes' },
            { key: 'meshCount', label: 'basic_meshes' },
            { key: 'materialSlotsUsed', label: 'material_slots' },
            { key: 'boneCount', label: 'bones' },
            { key: 'totalVertices', label: 'vertices' },
            { key: 'blendShapeCount', label: 'blend_shapes' }
        ]
    },
    {
        label: 'dynamics',
        stats: [
            { key: 'physBoneComponentCount', label: 'physbone_components' },
            { key: 'physBoneTransformCount', label: 'affected_transforms' },
            { key: 'physBoneColliderCount', label: 'physbone_colliders' },
            {
                key: 'physBoneCollisionCheckCount',
                label: 'collision_checks'
            },
            { key: 'contactCount', label: 'contacts' },
            { key: 'constraintCount', label: 'constraints' },
            { key: 'constraintDepth', label: 'constraint_depth' }
        ]
    },
    {
        label: 'components',
        stats: [
            { key: 'animatorCount', label: 'animators' },
            { key: 'particleSystemCount', label: 'particle_systems' },
            { key: 'totalMaxParticles', label: 'max_particles' },
            {
                key: 'meshParticleMaxPolygons',
                label: 'mesh_particle_triangles'
            },
            { key: 'lightCount', label: 'lights' },
            { key: 'audioSourceCount', label: 'audio_sources' },
            { key: 'raycastCount', label: 'raycasts' },
            { key: 'clothCount', label: 'cloths' },
            { key: 'totalClothVertices', label: 'cloth_vertices' },
            { key: 'trailRendererCount', label: 'trail_renderers' },
            { key: 'lineRendererCount', label: 'line_renderers' },
            { key: 'physicsColliders', label: 'physics_colliders' },
            { key: 'physicsRigidbodies', label: 'rigidbodies' },
            {
                key: 'particleTrailsEnabled',
                label: 'particle_trails',
                format: 'boolean'
            },
            {
                key: 'particleCollisionEnabled',
                label: 'particle_collision',
                format: 'boolean'
            }
        ]
    }
];

function formatBounds(value: unknown, locale: string): string {
    if (!Array.isArray(value) || value.length === 0) {
        return EMPTY_VALUE;
    }
    const formatter = new Intl.NumberFormat(locale, {
        maximumFractionDigits: 2
    });
    const bounds = value.filter(
        (entry): entry is number => typeof entry === 'number'
    );
    return bounds.length
        ? bounds.map((entry) => formatter.format(entry)).join('×')
        : EMPTY_VALUE;
}

export function formatStatValue(
    value: unknown,
    format: PerformanceStat['format'],
    locale: string,
    t: TFunction
): string {
    if (format === 'boolean' && typeof value === 'boolean') {
        return value
            ? t('dialog.avatar.performance.yes')
            : t('dialog.avatar.performance.no');
    }
    if (format === 'bounds') {
        return formatBounds(value, locale);
    }
    return typeof value === 'number'
        ? new Intl.NumberFormat(locale).format(value)
        : EMPTY_VALUE;
}
