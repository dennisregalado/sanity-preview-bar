// The page an unknown or expired short preview link shows: pure Sanity UI, like the bar, so it
// reads as Sanity editor chrome rather than the site. Render it outside the site's layout.
import '@sanity/ui/styles.css'
import {
  Button,
  Card,
  Container,
  Flex,
  Heading,
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
import {Logo} from './logo'

export type {PreviewLinkErrorData}

const theme = buildTheme()
const TTL_DAYS = PREVIEW_LINK_TTL_SECONDS / (24 * 60 * 60)

function Message({expired, brand, home = '/'}: PreviewLinkErrorData) {
  const title = expired ? 'This preview link has expired' : 'This preview link couldn’t be opened'
  const body = expired
    ? `Preview links open for ${TTL_DAYS} days. Ask the person who shared it for a new link.`
    : 'Something went wrong on our side. Try the link again in a moment.'

  return (
    <Card as="main" style={{minHeight: '100dvh'}}>
      <Flex align="center" justify="center" padding={4} style={{minHeight: '100dvh'}}>
        <Container width={0}>
          <Card padding={4} border>
            <Stack gap={4}>
              {brand.logo && <Logo logo={brand.logo} />}
              <Stack gap={3}>
                <Heading as="h1" size={1}>
                  {title}
                </Heading>
                <Text size={1} muted>
                  {body}
                </Text>
              </Stack>
              <Flex>
                <Button as="a" href={home} mode="ghost" padding={3} text={`Go to ${brand.title}`} />
              </Flex>
            </Stack>
          </Card>
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
