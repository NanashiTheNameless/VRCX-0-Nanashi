// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    t: (key: string) => key,
    endpoints: [] as {
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        hasKey: boolean;
        models: string[];
        modelReasoning: {
            modelId: string;
            supportedEfforts: string[];
            mandatory: boolean;
        }[];
        lastDetectedAt: string | null;
    }[],
    load: vi.fn(),
    upsert: vi.fn(),
    deleteEndpoint: vi.fn(),
    detectModels: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: mocks.t
    })
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/state/llmEndpointsStore', () => ({
    mergeModels: (...lists: string[][]) => [...new Set(lists.flat())],
    useLlmEndpointsStore: (
        selector: (state: {
            endpoints: typeof mocks.endpoints;
            loading: boolean;
            load: typeof mocks.load;
            upsert: typeof mocks.upsert;
            deleteEndpoint: typeof mocks.deleteEndpoint;
            detectModels: typeof mocks.detectModels;
        }) => unknown
    ) =>
        selector({
            endpoints: mocks.endpoints,
            loading: false,
            load: mocks.load,
            upsert: mocks.upsert,
            deleteEndpoint: mocks.deleteEndpoint,
            detectModels: mocks.detectModels
        })
}));

vi.mock('@/ui/shadcn/badge', () => ({
    Badge: ({ children }: PropsWithChildren) => <span>{children}</span>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: PropsWithChildren<
        ComponentProps<'button'> & { variant?: string; size?: string }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/combobox', () => ({
    Combobox: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ComboboxChip: ({ children }: PropsWithChildren) => <span>{children}</span>,
    ComboboxChips: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ComboboxChipsInput: (props: ComponentProps<'input'>) => (
        <input {...props} />
    ),
    ComboboxContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ComboboxEmpty: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ComboboxItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
    ComboboxList: () => <div />,
    ComboboxValue: ({
        children
    }: {
        children: (models: string[]) => ReactNode;
    }) => <>{children([])}</>,
    useComboboxAnchor: () => null
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => (
        <section>{children}</section>
    ),
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogFooter: ({ children }: PropsWithChildren) => (
        <footer>{children}</footer>
    ),
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/input', () => ({
    Input: (props: ComponentProps<'input'>) => <input {...props} />
}));

vi.mock('@/ui/shadcn/label', () => ({
    Label: ({ children, ...props }: ComponentProps<'label'>) => (
        <label {...props}>{children}</label>
    )
}));

vi.mock('@/ui/shadcn/select', () => ({
    Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectValue: () => null
}));

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipTrigger: ({
        children,
        render: trigger
    }: PropsWithChildren<{ render?: ReactNode }>) => <>{trigger ?? children}</>
}));

import { LlmEndpointsDialog } from './LlmEndpointsDialog';

function inputByLabel(label: string): HTMLInputElement {
    const element = screen.getByLabelText(label);
    expect(element).toBeInstanceOf(HTMLInputElement);
    return element as HTMLInputElement;
}

describe('LlmEndpointsDialog', () => {
    beforeEach(() => {
        mocks.endpoints = [];
        mocks.load.mockReset();
        mocks.upsert.mockReset();
        mocks.deleteEndpoint.mockReset();
        mocks.detectModels.mockReset();
        mocks.toastAdd.mockReset();
        mocks.load.mockResolvedValue([]);
        mocks.upsert.mockResolvedValue({});
        mocks.detectModels.mockResolvedValue({
            models: ['openai/o3'],
            modelReasoning: [
                {
                    modelId: 'openai/o3',
                    supportedEfforts: ['low', 'medium', 'high'],
                    mandatory: false
                }
            ]
        });
    });

    afterEach(() => cleanup());

    it('saves automatically detected reasoning metadata for a new endpoint', async () => {
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.add'
            })
        );
        fireEvent.change(
            await screen.findByLabelText('view.tools.llm_endpoints.api_key'),
            { target: { value: 'sk-test' } }
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    models: ['openai/o3'],
                    modelReasoning: [
                        {
                            modelId: 'openai/o3',
                            supportedEfforts: ['low', 'medium', 'high'],
                            mandatory: false
                        }
                    ]
                })
            )
        );
    });

    it('ignores model detection after the endpoint target changes', async () => {
        let resolveDetection: (value: {
            models: string[];
            modelReasoning: {
                modelId: string;
                supportedEfforts: string[];
                mandatory: boolean;
            }[];
        }) => void = () => undefined;
        mocks.detectModels.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveDetection = resolve;
                })
        );
        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.add'
            })
        );
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'view.tools.llm_endpoints.detect_models'
            })
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.base_url'),
            { target: { value: 'https://other.example/v1' } }
        );
        await act(async () => {
            resolveDetection({
                models: ['stale-model'],
                modelReasoning: []
            });
        });

        expect(mocks.toastAdd).not.toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'view.tools.llm_endpoints.models_detected'
            })
        );
    });

    it('preserves existing reasoning metadata when saving without detection', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-existing',
                hasKey: true,
                models: ['openai/o3'],
                modelReasoning: [
                    {
                        modelId: 'openai/o3',
                        supportedEfforts: ['low', 'medium', 'high'],
                        mandatory: false
                    }
                ],
                lastDetectedAt: '2026-08-07T00:00:00.000Z'
            }
        ];

        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        const apiKeyInput = inputByLabel('view.tools.llm_endpoints.api_key');
        expect(apiKeyInput.type).toBe('password');
        expect(apiKeyInput.value).toBe('sk-existing');
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.show_key'
            })
        );
        expect(apiKeyInput.type).toBe('text');
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.hide_key'
            })
        );
        expect(apiKeyInput.type).toBe('password');
        fireEvent.click(
            await screen.findByRole('button', {
                name: 'common.actions.save'
            })
        );

        await waitFor(() =>
            expect(mocks.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'endpoint-1',
                    apiKey: 'sk-existing',
                    modelReasoning: null
                })
            )
        );
        expect(mocks.detectModels).not.toHaveBeenCalled();
    });

    it('does not carry a stored key to a different base URL', async () => {
        mocks.endpoints = [
            {
                id: 'endpoint-1',
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                apiKey: 'sk-existing',
                hasKey: true,
                models: [],
                modelReasoning: [],
                lastDetectedAt: null
            }
        ];

        render(<LlmEndpointsDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.tools.llm_endpoints.edit'
            })
        );
        fireEvent.change(
            screen.getByLabelText('view.tools.llm_endpoints.base_url'),
            { target: { value: 'https://other.example/v1' } }
        );

        const apiKeyInput = inputByLabel('view.tools.llm_endpoints.api_key');
        expect(apiKeyInput.value).toBe('');
        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.save' })
        );

        await waitFor(() => expect(mocks.detectModels).toHaveBeenCalled());
        expect(mocks.detectModels).toHaveBeenCalledWith(
            expect.objectContaining({
                baseUrl: 'https://other.example/v1',
                apiKey: null
            })
        );
    });
});
