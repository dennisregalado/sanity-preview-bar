/**
 * Presentation's share menu (`SharePreviewMenu`, `sanity@6.23`), in the bar: the "Share this
 * preview" switch, a QR code to open the preview on a phone, and "Copy preview link". The same
 * layout, copy and sizes; the link is the bar's own short `/p/<code>` link (minted by
 * `/preview-bar/share`, stored in KV, 2 days) instead of Presentation's URL with the secret in it.
 *
 * The switch is Presentation's own setting (`enablePreviewAccessSharing` /
 * `disablePreviewAccessSharing` from `@sanity/preview-url-secret`), so it stays in step with
 * Presentation: links are minted only while it's on. Toggling needs the editor's Studio client, so
 * it works for signed-in editors (the Studio layer reports the client); everyone else sees it
 * read-only.
 */
import CheckmarkCircleIcon from '@sanity/icons/CheckmarkCircle'
import CopyIcon from '@sanity/icons/Copy'
import ErrorOutlineIcon from '@sanity/icons/ErrorOutline'
import ShareIcon from '@sanity/icons/Share'
import {SanityMonogram} from '@sanity/logos'
import {Box, Button, Card, Flex, Grid, Spinner, Stack, Switch, Text} from '@sanity/ui'
import {Menu, MenuButton, MenuDivider, MenuItem} from '@sanity/ui/menu'
import {Popover} from '@sanity/ui/popover'
import {Tooltip} from '@sanity/ui/tooltip'
import {lazy, Suspense, useEffect, useRef, useState, type CSSProperties} from 'react'
import {useBarData} from './context'

/** What the Studio layer reports for toggling sharing: the editor's client and user ID. */
export type StudioSharingClient = {client: unknown; userId?: string}

// Presentation lazy-loads its QR code the same way. Its renderer is `qrcode.react`'s.
const QRCodeSVG = lazy(() => import('qrcode.react').then((module) => ({default: module.QRCodeSVG})))

/** A transparent pixel: `qrcode.react` clears the logo's square only when given an image. */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

/** The share endpoint refused because Presentation's sharing is off. */
class SharingOffError extends Error {}

/** Asks the server for a short `/p/<code>` link to `path` in the current perspective. */
async function requestShareLink(basePath: string, path: string) {
  const response = await fetch(`${basePath}/share`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({pathname: path}),
  })
  if (response.status === 409) throw new SharingOffError()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const {url} = (await response.json()) as {url: string; expiresAt: string}
  return url
}

/** The Clipboard API (as Presentation does), then the selection fallback. */
async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

/** How long the "Link copied" confirmation stays up. */
const CONFIRMATION_MS = 3000

/** Presentation's QR code: 224px, error level L, a 40px hole with the Sanity monogram on top. */
function PreviewQrCode({url}: {url: string}) {
  return (
    <>
      <QRCodeSVG
        value={url}
        size={224}
        level="L"
        bgColor="transparent"
        fgColor="currentColor"
        title={`A QR Code which encodes the URL: ${url}`}
        imageSettings={{src: BLANK_IMAGE, height: 40, width: 40, excavate: true}}
        style={{color: 'var(--card-fg-color)', display: 'block'}}
      />
      <SanityMonogram
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 24,
          height: 24,
          transform: 'translate(-50%, -50%)',
        }}
      />
    </>
  )
}

export function ShareMenu({
  sharing: initialSharing,
  path,
  perspectiveKey,
  studio,
  setOverflow,
}: {
  /** Presentation's "Share this preview" was on when the bar loaded. */
  sharing: boolean
  path: string
  /** The current perspective; a new one needs a new link. */
  perspectiveKey: string
  /** Signed-in editors' Studio client, for the switch; `null` makes it read-only. */
  studio: StudioSharingClient | null
  setOverflow: (key: string, visible: boolean) => void
}) {
  const {basePath, studioPath} = useBarData()
  const [sharing, setSharing] = useState(initialSharing)
  const [open, setOpen] = useState(false)
  const [toggling, setToggling] = useState<'enabling' | 'disabling' | null>(null)
  const [minting, setMinting] = useState(false)
  const [link, setLink] = useState<{key: string; url: string} | null>(null)
  const [confirmation, setConfirmation] = useState<'copied' | 'failed' | null>(null)
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const key = `${perspectiveKey} ${path}`
  const url = sharing && link?.key === key ? link.url : null
  const busy = toggling !== null || minting

  // A link for this page and perspective whenever the menu is open with sharing on.
  useEffect(() => {
    if (!open || !sharing || link?.key === key) return
    let cancelled = false
    setMinting(true)
    requestShareLink(basePath, path)
      .then((next) => {
        if (!cancelled) setLink({key, url: next})
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof SharingOffError) setSharing(false)
        else console.error('Preview bar: could not create a preview link', err)
      })
      .finally(() => {
        if (!cancelled) setMinting(false)
      })
    return () => {
      cancelled = true
      setMinting(false)
    }
  }, [open, sharing, link, key, basePath, path])

  // The confirmation floats above the bar, so the host must stop clipping the frame meanwhile.
  useEffect(() => {
    if (!confirmation) return
    setOverflow('copy-confirmation', true)
    return () => setOverflow('copy-confirmation', false)
  }, [confirmation, setOverflow])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function toggleSharing() {
    if (!studio || toggling) return
    const enable = !sharing
    setToggling(enable ? 'enabling' : 'disabling')
    try {
      const {enablePreviewAccessSharing, disablePreviewAccessSharing} =
        await import('@sanity/preview-url-secret/toggle-preview-access-sharing')
      const studioUrl = `${window.location.origin}${studioPath}/presentation`
      const client = studio.client as Parameters<typeof enablePreviewAccessSharing>[0]
      if (enable) {
        await enablePreviewAccessSharing(client, 'sanity/presentation', studioUrl, studio.userId)
      } else {
        await disablePreviewAccessSharing(client, 'sanity/presentation', studioUrl, studio.userId)
        setLink(null)
      }
      setSharing(enable)
    } catch (err) {
      console.error('Preview bar: could not change preview sharing', err)
    } finally {
      setToggling(null)
    }
  }

  async function copyLink() {
    if (!url) return
    const copied = await copyText(url)
    setConfirmation(copied ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setConfirmation(null), CONFIRMATION_MS)
  }

  const failed = confirmation === 'failed'
  const switchTooltip = studio
    ? url
      ? 'Disable sharing'
      : 'Enable sharing'
    : 'Sign in to the Studio to change sharing'

  const menu = (
    <Menu style={{maxWidth: 248}}>
      <label style={{cursor: studio ? 'pointer' : 'default'}}>
        <Grid
          gapX={3}
          gapY={1}
          paddingTop={3}
          paddingX={3}
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            gridTemplateColumns: 'min-content 1fr',
            gridTemplateRows: 'min-content',
          }}
        >
          <Tooltip
            animate
            content={
              <Text size={1} as="div">
                {switchTooltip}
              </Text>
            }
            padding={2}
            fallbackPlacements={['top-start']}
            placement="top"
            portal
            zOffset={3100}
          >
            <Switch
              checked={toggling === 'enabling' || (sharing && toggling !== 'disabling')}
              readOnly={!studio || toggling !== null}
              onChange={() => void toggleSharing()}
            />
          </Tooltip>
          <Text size={1} weight="medium" as="div">
            Share this preview
          </Text>
          <span />
          <Text muted size={1} as="div">
            with anyone who has the link
          </Text>
        </Grid>
      </label>
      <Box padding={3} paddingTop={2}>
        <Stack gap={3}>
          <Card
            tone={busy || !url ? 'transparent' : undefined}
            style={{
              position: 'relative',
              aspectRatio: '1 / 1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {busy ? (
              <Spinner muted />
            ) : url ? (
              <Suspense fallback={<Spinner />}>
                <PreviewQrCode url={url} />
              </Suspense>
            ) : (
              <Text
                muted
                size={1}
                as="div"
                style={{maxWidth: 100, textWrap: 'pretty', textAlign: 'center'} as CSSProperties}
              >
                QR code will appear here
              </Text>
            )}
          </Card>
          <Text muted size={1} as="div">
            Scan the QR Code to open the preview on your phone.
          </Text>
        </Stack>
      </Box>
      <MenuDivider />
      <MenuItem
        disabled={!url || toggling === 'disabling'}
        icon={CopyIcon}
        onClick={() => void copyLink()}
        text="Copy preview link"
      />
    </Menu>
  )

  const confirmationContent = (
    <Flex align="center" gap={2} padding={3}>
      {/* Sanity UI's `Text` colours `[data-sanity-icon]` with `--card-icon-color`. */}
      <Text
        size={1}
        style={
          {
            '--card-icon-color': failed
              ? 'var(--card-badge-critical-icon-color)'
              : 'var(--card-badge-positive-icon-color)',
          } as CSSProperties
        }
      >
        {failed ? <ErrorOutlineIcon /> : <CheckmarkCircleIcon />}
      </Text>
      <Text size={1}>{failed ? 'Copy failed' : 'Link copied. Expires in 2 days.'}</Text>
    </Flex>
  )

  return (
    <span ref={setAnchor} style={{display: 'flex'}}>
      <MenuButton
        id="preview-bar-share"
        onOpen={() => {
          setOpen(true)
          setOverflow('share-menu', true)
        }}
        onClose={() => {
          setOpen(false)
          setOverflow('share-menu', false)
        }}
        popover={{
          animate: true,
          constrainSize: true,
          placement: 'top',
          fallbackPlacements: ['top-end', 'top-start'],
          portal: true,
          tone: 'default',
          zOffset: 3000,
        }}
        button={<Button mode="bleed" padding={2} icon={ShareIcon} aria-label="Share preview" />}
        menu={menu}
      />
      {/* Anchored by element, above the button, after the menu closes. */}
      <Popover
        referenceElement={anchor}
        content={confirmationContent}
        open={confirmation !== null}
        portal
        animate
        placement="top"
        fallbackPlacements={['top-end', 'top-start']}
        tone="default"
        zOffset={3000}
        role="status"
      />
    </span>
  )
}
