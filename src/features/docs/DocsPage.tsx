import { SearchIcon } from 'lucide-react';
import {
    Children,
    isValidElement,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useSearchParams } from 'react-router';
import remarkGfm from 'remark-gfm';

import {
    PageBody,
    PageDescription,
    PageHeader,
    PageScaffold,
    PageTitle
} from '@/components/layout/PageScaffold';
import { searchDocs } from '@/features/assistant/assistantDocs';
import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/entityMediaService';
import { Input } from '@/ui/shadcn/input';

import {
    DOC_SOURCES,
    getDocSource,
    headingSlug,
    resolveDocLink,
    splitDocSections,
    type DocSource
} from './docsCatalog';

const P = 'view.docs';
const DEFAULT_DOC = 'user_guide';

function textOf(children: ReactNode): string {
    return Children.toArray(children)
        .map((child) => {
            if (typeof child === 'string' || typeof child === 'number') {
                return String(child);
            }
            if (isValidElement<{ children?: ReactNode }>(child)) {
                return textOf(child.props.children);
            }
            return '';
        })
        .join('');
}

function useDocComponents(
    doc: DocSource,
    openDoc: (docId: string, anchor?: string) => void
): Components {
    return useMemo(() => {
        const heading =
            (Tag: 'h1' | 'h2' | 'h3' | 'h4', className: string) =>
            ({ children }: { children?: ReactNode }) => (
                <Tag
                    id={headingSlug(textOf(children))}
                    className={cn('scroll-mt-4', className)}
                >
                    {children}
                </Tag>
            );
        return {
            h1: heading('h1', 'mt-2 mb-3 text-2xl font-semibold'),
            h2: heading('h2', 'mt-6 mb-2 border-b pb-1 text-xl font-semibold'),
            h3: heading('h3', 'mt-5 mb-2 text-lg font-semibold'),
            h4: heading('h4', 'mt-4 mb-1 font-semibold'),
            p: ({ children }) => (
                <p className="my-2 leading-relaxed">{children}</p>
            ),
            ul: ({ children }) => (
                <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
            ),
            ol: ({ children }) => (
                <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
            ),
            code: ({ children }) => (
                <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">
                    {children}
                </code>
            ),
            pre: ({ children }) => (
                <pre className="bg-muted my-3 overflow-x-auto rounded-md p-3 text-sm [&_code]:bg-transparent [&_code]:p-0">
                    {children}
                </pre>
            ),
            blockquote: ({ children }) => (
                <blockquote className="text-muted-foreground my-3 border-l-4 pl-3">
                    {children}
                </blockquote>
            ),
            table: ({ children }) => (
                <div className="my-3 max-w-full overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        {children}
                    </table>
                </div>
            ),
            thead: ({ children }) => (
                <thead className="border-b">{children}</thead>
            ),
            tr: ({ children }) => (
                <tr className="border-border/40 border-b last:border-0">
                    {children}
                </tr>
            ),
            th: ({ children }) => (
                <th className="px-3 py-1.5 text-left font-medium">
                    {children}
                </th>
            ),
            td: ({ children }) => (
                <td className="px-3 py-1.5 align-top">{children}</td>
            ),
            // Images (mostly README badges) would be fetched from the web;
            // the viewer makes no requests, so it shows their text instead.
            img: ({ alt }) =>
                alt ? (
                    <span className="text-muted-foreground">{alt}</span>
                ) : null,
            a: ({ href, children }) => (
                <a
                    href={href}
                    className="text-primary cursor-pointer underline underline-offset-2"
                    onClick={(event) => {
                        event.preventDefault();
                        if (!href) {
                            return;
                        }
                        const target = resolveDocLink(doc.path, href);
                        if (target.kind === 'doc') {
                            openDoc(target.docId || doc.id, target.anchor);
                        } else {
                            openExternalLink(target.url);
                        }
                    }}
                >
                    {children}
                </a>
            )
        };
    }, [doc, openDoc]);
}

export function DocsPage() {
    const { t } = useTranslation();
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const doc =
        getDocSource(params.get('doc') ?? DEFAULT_DOC) ??
        getDocSource(DEFAULT_DOC) ??
        DOC_SOURCES[0];
    const anchor = params.get('section') ?? '';

    const openDoc = useMemo(
        () => (docId: string, section?: string) => {
            setParams(
                (current) => {
                    current.set('doc', docId);
                    if (section) {
                        current.set('section', section);
                    } else {
                        current.delete('section');
                    }
                    return current;
                },
                { replace: false }
            );
        },
        [setParams]
    );
    const components = useDocComponents(doc, openDoc);
    const contents = useMemo(
        () =>
            splitDocSections(doc.id, doc.text).filter(
                (section) =>
                    section.heading &&
                    section.path.length >= 2 &&
                    section.path.length <= 3
            ),
        [doc]
    );
    const results = useMemo(
        () => (query.trim() ? searchDocs(query) : null),
        [query]
    );

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const target = anchor
            ? container.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`)
            : null;
        if (target) {
            target.scrollIntoView({ block: 'start' });
        } else {
            container.scrollTop = 0;
        }
    }, [anchor, doc.id]);

    return (
        <PageScaffold className="flex-1">
            <PageHeader>
                <PageTitle>{t(`${P}.title`)}</PageTitle>
                <PageDescription>{t(`${P}.description`)}</PageDescription>
            </PageHeader>
            <PageBody>
                <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
                    <nav
                        className="flex shrink-0 flex-col gap-2 md:w-60 md:overflow-y-auto"
                        aria-label={t(`${P}.list`)}
                    >
                        <div className="relative">
                            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
                            <Input
                                className="pl-8"
                                value={query}
                                placeholder={t(`${P}.search`)}
                                aria-label={t(`${P}.search`)}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                            />
                        </div>
                        {results && 'results' in results ? (
                            results.results.length ? (
                                <ul className="flex flex-col gap-1">
                                    {results.results.map((result) => (
                                        <li
                                            key={`${result.docId}:${result.section}`}
                                        >
                                            <button
                                                type="button"
                                                className="hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm"
                                                onClick={() => {
                                                    const heading =
                                                        result.section
                                                            .split(' > ')
                                                            .at(-1) ?? '';
                                                    openDoc(
                                                        result.docId,
                                                        headingSlug(heading)
                                                    );
                                                }}
                                            >
                                                <span className="block font-medium">
                                                    {result.section ||
                                                        getDocSource(
                                                            result.docId
                                                        )?.title}
                                                </span>
                                                <span className="text-muted-foreground line-clamp-2 text-xs">
                                                    {result.text.slice(0, 160)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-muted-foreground px-2 text-sm">
                                    {t(`${P}.no_results`)}
                                </p>
                            )
                        ) : (
                            <ul className="flex flex-col gap-0.5">
                                {DOC_SOURCES.map((source) => (
                                    <li key={source.id}>
                                        <button
                                            type="button"
                                            aria-current={
                                                source.id === doc.id
                                                    ? 'page'
                                                    : undefined
                                            }
                                            className={cn(
                                                'hover:bg-muted w-full rounded px-2 py-1.5 text-left text-sm',
                                                source.id === doc.id &&
                                                    'bg-muted font-medium'
                                            )}
                                            onClick={() => openDoc(source.id)}
                                        >
                                            {source.title}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </nav>
                    <div
                        ref={scrollRef}
                        className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1"
                    >
                        <article
                            className="max-w-3xl pb-10 text-sm"
                            data-doc={doc.id}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={components}
                            >
                                {doc.text}
                            </ReactMarkdown>
                        </article>
                    </div>
                    {contents.length ? (
                        <nav
                            className="hidden shrink-0 flex-col gap-1 overflow-y-auto text-sm xl:flex xl:w-56"
                            aria-label={t(`${P}.contents`)}
                        >
                            <span className="text-muted-foreground text-xs font-medium">
                                {t(`${P}.contents`)}
                            </span>
                            {contents.map((section) => (
                                <button
                                    key={section.path.join('>')}
                                    type="button"
                                    className={cn(
                                        'hover:text-foreground text-muted-foreground text-left',
                                        section.path.length === 3 &&
                                            'pl-3 text-xs'
                                    )}
                                    onClick={() =>
                                        openDoc(
                                            doc.id,
                                            headingSlug(section.heading)
                                        )
                                    }
                                >
                                    {section.heading}
                                </button>
                            ))}
                        </nav>
                    ) : null}
                </div>
            </PageBody>
        </PageScaffold>
    );
}
