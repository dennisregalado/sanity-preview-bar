/**
 * `sanity-preview-bar/studio`: the Visual Editor tool for the Studio. Presentation's layout with
 * the preview bar on top, the site in the middle (desktop or a 375px phone) and the document pane
 * on the right. The bar's **Edit** on the site opens a page here (`visualEditor` bar option).
 *
 * ```ts
 * // sanity.config.ts
 * import {visualEditorTool} from 'sanity-preview-bar/studio'
 * plugins: [visualEditorTool({previewUrl: {previewMode: {enable: '/preview/enable'}}})]
 * ```
 */
import EditIcon from '@sanity/icons/Edit'
import {createElement, type ReactNode} from 'react'
import {definePlugin} from 'sanity'
import {route, useRouter} from 'sanity/router'
import type {
  DocumentLocationResolverObject,
  DocumentLocationsState,
  DocumentResolver,
} from 'sanity/presentation'
import {locationsInput} from './locations'
import {VisualEditorTool, type VisualEditorToolOptions} from './VisualEditorTool'

export type {VisualEditorToolOptions}
export type {VisualEditorLocations} from './locations'
export type {
  DocumentLocation,
  DocumentLocationResolver,
  DocumentLocationResolverObject,
  DocumentLocationResolvers,
  DocumentLocationsState,
  DocumentResolver,
  DocumentResolverContext,
} from 'sanity/presentation'

/**
 * Presentation's `defineLocations`, for `resolve.locations`: types a resolver, does nothing else.
 * The same resolvers work in both tools.
 */
export function defineLocations<K extends string>(
  resolver: DocumentLocationResolverObject<K> | DocumentLocationsState,
): typeof resolver {
  return resolver
}

/** Presentation's `defineDocuments`, for `resolve.mainDocuments`: types the list, nothing else. */
export function defineDocuments(resolvers: DocumentResolver[]): typeof resolvers {
  return resolvers
}

type NavbarProps = {renderDefault: (props: NavbarProps) => ReactNode}

/**
 * The Studio's navbar, except in the Visual Editor, where the preview bar is the toolbar (the
 * approach of `studio.components.navbar` middleware that renders nothing for one tool).
 */
function navbarFor(toolName: string) {
  return function VisualEditorNavbar(props: NavbarProps) {
    const {state} = useRouter()
    return state.tool === toolName ? null : props.renderDefault(props)
  }
}

export const visualEditorTool = definePlugin<VisualEditorToolOptions | void>((options) => {
  const settings = options ?? {}
  const toolName = settings.name ?? 'visual-editor'
  const locations = settings.resolve?.locations
  return {
    name: 'sanity-preview-bar/visual-editor',
    // "Used on N pages" above every document form, as Presentation's `resolve.locations` does.
    ...(locations ? {form: {components: {input: locationsInput(locations, toolName)}}} : {}),
    ...(settings.hideStudioNavbar === false
      ? {}
      : {studio: {components: {navbar: navbarFor(toolName) as never}}}),
    tools: [
      {
        name: toolName,
        title: settings.title ?? 'Visual Editor',
        icon: EditIcon,
        options: settings,
        // `?preview=/path` at the top level, as Presentation's router does.
        router: route.create('/', {__unsafe_disableScopedSearchParams: true}),
        component: (props: {tool: unknown}) =>
          createElement(VisualEditorTool, props as Parameters<typeof VisualEditorTool>[0]),
      },
    ],
  }
})
