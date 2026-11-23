/**
 * The bar's data in the Visual Editor tool, from the Studio instead of the site, so the bar
 * renders the moment the tool does (as Presentation's toolbar does): the workspace (title, icon,
 * base path, project), the project's name, the active releases (live, from the Studio's releases
 * store), the Studio's perspective, and Presentation's "Share this preview" state (read with the
 * editor's own client). What the Studio can't know, the tool's options say.
 */
import {fetchSharedAccessQuery} from '@sanity/preview-url-secret/constants'
import {useEffect, useMemo, useState} from 'react'
import {
  useActiveReleases,
  useClient,
  usePerspective,
  useProject,
  useSchema,
  useWorkspace,
} from 'sanity'
import type {PreviewBarData} from '../core/data'
import {perspectiveStack, type ReleaseDocument, serializePerspective} from '../core/perspective'

export type StudioBarDataOptions = {
  /** The bar's route on the site (its share, perspective, search and resolve endpoints). */
  barPath: string
  /** The site serves short preview links (`links` in `createPreviewBar`). */
  links: boolean
  /** Document types the Studio search opens filtered to (default: all), as the site's `search`. */
  searchTypes?: string[]
}

export function useStudioBarData({barPath, links, searchTypes}: StudioBarDataOptions) {
  const workspace = useWorkspace()
  const project = useProject()
  const schema = useSchema()
  const {data: releases, error: releasesError} = useActiveReleases()
  const {selectedPerspectiveName, excludedPerspectives} = usePerspective()
  const client = useClient({apiVersion: '2025-02-19'})

  // Presentation's sharing secret exists only while "Share this preview" is on.
  const [sharing, setSharing] = useState(false)
  useEffect(() => {
    if (!links) return
    let cancelled = false
    client
      .fetch<string | null>(fetchSharedAccessQuery, {}, {tag: 'preview-bar.sharing'})
      .then((secret) => {
        if (!cancelled) setSharing(Boolean(secret))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [client, links])

  const releaseList = releases as unknown as ReleaseDocument[]
  // Seeds the bar's switcher; later switches go through the tool's perspective messages.
  const perspective = serializePerspective(
    perspectiveStack({
      selected: selectedPerspectiveName ?? 'drafts',
      releases: releaseList,
      excluded: excludedPerspectives ?? [],
    }),
  )
  const searchKey = searchTypes?.join(',')

  return useMemo<PreviewBarData>(
    () => ({
      brand: {
        title: workspace.title,
        icon: workspace.icon as PreviewBarData['brand']['icon'],
        project: project?.displayName,
      },
      studioPath: workspace.basePath || '/',
      projectId: workspace.projectId,
      basePath: barPath,
      releases: releaseList,
      releasesError: Boolean(releasesError),
      sharing,
      links,
      perspective,
      // The tool resolves the page's document itself and tells the bar (`editor-state`).
      pageDocuments: false,
      // The Studio's own search, filtered to these types (all types when none are given).
      search: (searchTypes ?? []).map((type) => ({
        kind: type,
        title: schema.get(type)?.title ?? type,
      })),
    }),
    // `perspective` only seeds the bar, and `searchTypes` is compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, project, releaseList, releasesError, sharing, links, barPath, schema, searchKey],
  )
}
