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
import {createElement} from 'react'
import {definePlugin} from 'sanity'
import {route} from 'sanity/router'
import {VisualEditorTool, type VisualEditorToolOptions} from './VisualEditorTool'

export type {VisualEditorToolOptions}

export const visualEditorTool = definePlugin<VisualEditorToolOptions | void>((options) => {
  const settings = options ?? {}
  return {
    name: 'sanity-preview-bar/visual-editor',
    tools: [
      {
        name: settings.name ?? 'visual-editor',
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
