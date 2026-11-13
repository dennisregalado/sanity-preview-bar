// The page an unknown or expired short preview link shows: pure Sanity UI, like the bar, so it
// reads as Sanity editor chrome rather than the site. Render it outside the site's layout.
//
// The layout is Presentation's `ErrorCard` (`sanity@6.23`, "An error occurred / Could not connect
// to the preview"): a full-height card centring a `Container size={0} padding={4}`, a gap-4 stack
// of the semibold title and muted message (gap 3) over one ghost button with the Studio `Button`
// defaults (`padding={2}`, `gap={2}`). Its Retry becomes "Open Studio"; there's no "Continue anyway".
import '@sanity/ui/styles.css'
import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Stack,
  Text,
  ThemeProvider,
  usePrefersDark,
} from '@sanity/ui'
import {buildTheme} from '@sanity/ui/theme'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import type {PreviewLinkErrorData} from '../core/data'
import {PREVIEW_LINK_TTL_SECONDS} from '../core/preview-links'
import {injectStudioDocumentCss} from './document-css'

export type {PreviewLinkErrorData}

const theme = buildTheme()
const TTL_DAYS = PREVIEW_LINK_TTL_SECONDS / (24 * 60 * 60)

function Message({expired, studioPath = '/studio'}: PreviewLinkErrorData) {
  const title = expired ? 'This preview link has expired' : 'This preview link couldn’t be opened'
  const message = expired
    ? `Preview links open for ${TTL_DAYS} days. Ask the person who shared it for a new link.`
    : 'Something went wrong on our side. Try the link again in a moment.'

  return (
    <Card as="main" height="fill" style={{minHeight: '100dvh'}}>
      <Flex align="center" justify="center" style={{minHeight: '100dvh'}}>
        <Container width={0} padding={4}>
          <Stack gap={4}>
            <Stack gap={3}>
              <Text as="h1" size={1} weight="semibold">
                {title}
              </Text>
              <Text as="p" size={1} muted>
                {message}
              </Text>
            </Stack>
            <Box>
              <Button
                as="a"
                href={studioPath}
                mode="ghost"
                padding={2}
                gap={2}
                text="Open Studio"
              />
            </Box>
          </Stack>
        </Container>
      </Flex>
    </Card>
  )
}

function App(props: PreviewLinkErrorData) {
  const scheme = usePrefersDark() ? 'dark' : 'light'
  return (
    <ThemeProvider theme={theme} scheme={scheme}>
      <Message {...props} />
    </ThemeProvider>
  )
}

/** Renders the message into `element` and returns its unmount function. */
export function mountPreviewLinkError(element: HTMLElement, data: PreviewLinkErrorData) {
  injectStudioDocumentCss(element.ownerDocument)
  const root = createRoot(element)
  root.render(
    <StrictMode>
      <App {...data} />
    </StrictMode>,
  )
  return () => root.unmount()
}
