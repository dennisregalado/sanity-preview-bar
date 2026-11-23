/**
 * The document side pane: the Studio's own document editor (header with the Published / Draft
 * chips, the form, presence, and the footer with Publish and the other document actions), the same
 * pane Presentation shows next to its preview. Rendered inside the Studio layer's `StudioProvider`,
 * so it edits in the bar's perspective with the project's own config, plugins and actions.
 *
 * Presentation's recipe (`sanity@6.23`, `PresentationToolGrantsCheck` → `DocumentPane$1` and
 * `PresentationPaneRouterProvider`), with public `sanity/structure` exports only:
 * `StructureToolProvider` → `PaneLayout` → a minimal `PaneRouterContext` → `DocumentPane`.
 *
 * The pane router here is a small stack: reference links open the referenced document in the pane,
 * and the header's close button (the router's `BackLink`) goes back, closing the panel from the
 * page's document.
 */
import {
  type ComponentType,
  type Context,
  type CSSProperties,
  forwardRef,
  type MouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useRef,
} from 'react'

type PaneParams = Record<string, string | undefined>

/** One document in the pane's stack, with its pane params (`path`, `inspect`, `rev`, …). */
export type PanelEntry = {
  id: string
  type: string
  params: PaneParams
  /** Creating a referenced document in place: the initial value template. */
  template?: string
  templateParameters?: Record<string, unknown>
}

/** The parts of `sanity/structure` the pane uses. */
export type StructureModule = {
  DocumentPane: ComponentType<{
    paneKey: string
    index: number
    itemId: string
    pane: unknown
    onFocusPath?: (path: unknown[]) => void
  }>
  PaneLayout: ComponentType<{style?: CSSProperties; children?: ReactNode}>
  PaneRouterContext: Context<unknown>
  StructureToolProvider: ComponentType<{children?: ReactNode}>
}

type LinkProps = {children?: ReactNode; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void}

/** An in-pane link: an anchor (the Studio styles these as buttons) that runs `action` on click. */
function paneLink<P extends object>(name: string, action: (props: P) => void) {
  const Link = forwardRef<HTMLAnchorElement, P & LinkProps>(function PaneLink(props, ref) {
    const {
      children,
      onClick,
      // Router-only props the anchor must not get.
      childId: _childId,
      childType: _childType,
      childParameters: _childParameters,
      childPayload: _childPayload,
      documentId: _documentId,
      documentType: _documentType,
      parentRefPath: _parentRefPath,
      template: _template,
      params: _params,
      payload: _payload,
      searchParams: _searchParams,
      ...rest
    } = props as LinkProps & Record<string, unknown>
    return (
      <a
        {...rest}
        ref={ref}
        href="#"
        onClick={(event) => {
          onClick?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          action(props as P)
        }}
      >
        {children}
      </a>
    )
  })
  Link.displayName = name
  return Link
}

function noop(name: string) {
  return () => console.warn(`sanity-preview-bar: the document pane has no "${name}"`)
}

function queryString(params: PaneParams) {
  const defined = Object.entries(params).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, value]],
  )
  return defined.length ? `?${new URLSearchParams(defined)}` : ''
}

function PaneRouter({
  structure,
  entry,
  onParams,
  onOpen,
  onBack,
  children,
}: {
  structure: StructureModule
  entry: PanelEntry
  onParams: (params: PaneParams) => void
  onOpen: (entry: PanelEntry) => void
  onBack: () => void
  children: ReactNode
}) {
  // Links are components: keep their identity stable across renders, or every link remounts.
  const links = useRef({onOpen, onBack})
  links.current = {onOpen, onBack}
  const components = useMemo(
    () => ({
      BackLink: paneLink<object>('PaneBackLink', () => links.current.onBack()),
      ChildLink: paneLink<{childId: string; childType?: string}>('PaneChildLink', (props) => {
        if (props.childType)
          links.current.onOpen({id: props.childId, type: props.childType, params: {}})
      }),
      ReferenceChildLink: paneLink<{documentId: string; documentType: string}>(
        'PaneReferenceChildLink',
        (props) =>
          links.current.onOpen({id: props.documentId, type: props.documentType, params: {}}),
      ),
      ParameterizedLink: paneLink<object>('PaneParameterizedLink', noop('ParameterizedLink')),
    }),
    [links],
  )

  const value = useMemo(
    () => ({
      // Presentation's values: the pane is the first (and only) one in its group.
      index: 0,
      groupIndex: 0,
      siblingIndex: 0,
      payload: {},
      params: entry.params,
      hasGroupSiblings: false,
      groupLength: 1,
      routerPanesState: [],
      ...components,
      handleEditReference: (options: {
        id: string
        type: string
        template: {id: string; params?: Record<string, unknown>}
      }) =>
        onOpen({
          id: options.id,
          type: options.type,
          params: {},
          template: options.template.id,
          templateParameters: options.template.params,
        }),
      replaceCurrent: noop('replaceCurrent'),
      closeCurrent: onBack,
      closeCurrentAndAfter: onBack,
      duplicateCurrent: noop('duplicateCurrent'),
      setView: noop('setView'),
      setParams: (params: PaneParams) => onParams(params),
      setPayload: noop('setPayload'),
      navigateIntent: noop('navigateIntent'),
      createPathWithParams: (params: PaneParams) => queryString({...entry.params, ...params}),
    }),
    [components, entry.params, onBack, onOpen, onParams],
  )

  const {PaneRouterContext} = structure
  return <PaneRouterContext.Provider value={value}>{children}</PaneRouterContext.Provider>
}

export function DocumentPanel({
  structure,
  stack,
  onChange,
  fallback,
}: {
  structure: StructureModule
  /** Bottom first: the page's document, then any references opened from it. */
  stack: PanelEntry[]
  onChange: (stack: PanelEntry[]) => void
  fallback: ReactNode
}) {
  const entry = stack[stack.length - 1]
  const depth = stack.length - 1

  const onParams = useCallback(
    (params: PaneParams) =>
      onChange(stack.map((item, index) => (index === depth ? {...item, params} : item))),
    [stack, depth, onChange],
  )
  const onOpen = useCallback((next: PanelEntry) => onChange([...stack, next]), [stack, onChange])
  const onBack = useCallback(() => onChange(stack.slice(0, -1)), [stack, onChange])

  const pane = useMemo(
    () =>
      entry && {
        id: entry.id,
        type: 'document',
        title: '',
        options: {
          id: entry.id,
          type: entry.type,
          template: entry.template,
          templateParameters: entry.templateParameters,
        },
      },
    [entry],
  )

  if (!entry || !pane) return null
  const {StructureToolProvider, PaneLayout, DocumentPane} = structure
  return (
    <StructureToolProvider>
      <PaneLayout style={{height: '100%'}}>
        <PaneRouter
          structure={structure}
          entry={entry}
          onParams={onParams}
          onOpen={onOpen}
          onBack={onBack}
        >
          <Suspense fallback={fallback}>
            <DocumentPane
              // A new document is a new pane: drop the previous one's form state.
              key={`${depth}:${entry.id}`}
              paneKey="document"
              index={1}
              itemId="document"
              pane={pane}
            />
          </Suspense>
        </PaneRouter>
      </PaneLayout>
    </StructureToolProvider>
  )
}
