// The Studio navbar's workspace menu (`WorkspaceMenuButton` + `ManageMenu` in `sanity@6.23`): the
// title with a chevron opens a menu showing the workspace icon, the project name and the title,
// with "Manage project" and "Invite members" linking to sanity.io/manage. The bar has one
// workspace, so there's no switcher list.
import AddUserIcon from '@sanity/icons/AddUser'
import ChevronDownIcon from '@sanity/icons/ChevronDown'
import CogIcon from '@sanity/icons/Cog'
import {Box, Button, Flex, Text} from '@sanity/ui'
import {Menu, MenuButton} from '@sanity/ui/menu'
import {type CSSProperties, useState} from 'react'

import {useBarData, useBarPlacement} from './context'
import {Logo} from './logo'
import {StudioTooltip} from './StudioTooltip'

/** `useEnvAwareSanityWebsiteUrl` for production projects. */
const SANITY_WEBSITE_URL = 'https://www.sanity.io'

export function WorkspaceMenu({
  onOpenChange,
  onHoverChange,
}: {
  onOpenChange: (open: boolean) => void
  /** Keeps the frame unclipped while the "Select workspace" tooltip can show. */
  onHoverChange: (hovered: boolean) => void
}) {
  const {brand, projectId} = useBarData()
  const place = useBarPlacement()
  const [open, setOpen] = useState(false)
  const manageUrl = projectId ? `${SANITY_WEBSITE_URL}/manage/project/${projectId}` : null

  return (
    <span
      style={{display: 'flex', minWidth: 0}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <StudioTooltip content="Select workspace" disabled={open}>
        {/* A span around `MenuButton`, which clones its `button` element to attach its ref. It
            also keeps the bar's foreground colour: the Studio's ui5 bleed button shows the title
            in full foreground (white in dark mode), where Sanity UI v4's bleed button redefines
            `--card-fg-color` to its muted shade inside the button. */}
        <span
          style={
            {
              display: 'flex',
              minWidth: 0,
              '--preview-bar-workspace-fg': 'var(--card-fg-color)',
            } as CSSProperties
          }
        >
          <MenuButton
            id="workspace-menu"
            onOpen={() => {
              setOpen(true)
              onOpenChange(true)
            }}
            onClose={() => {
              setOpen(false)
              onOpenChange(false)
            }}
            // `POPOVER_PROPS`, opening upward because the bar sits at the bottom of the page.
            popover={{
              animate: true,
              constrainSize: true,
              placement: place('top-start'),
              fallbackPlacements: [place('top'), place('top-end')],
              portal: true,
              tone: 'default',
              zOffset: 3000,
            }}
            button={
              <Button mode="bleed" padding={2} width="fill">
                <Flex align="center" gap={2}>
                  <Box style={{minWidth: 0}}>
                    <Text
                      size={1}
                      weight="medium"
                      textOverflow="ellipsis"
                      as="div"
                      style={{color: 'var(--preview-bar-workspace-fg)'}}
                    >
                      {brand.title}
                    </Text>
                  </Box>
                  {/* ui5 `<Icon size={1}>` (21px) with `margin: -0.375rem`, as the Studio draws it. */}
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'block',
                      flex: 'none',
                      fontSize: 21,
                      lineHeight: 0,
                      margin: '-0.375rem',
                      color: 'var(--preview-bar-workspace-fg)',
                    }}
                  >
                    <ChevronDownIcon style={{display: 'block'}} />
                  </span>
                </Flex>
              </Button>
            }
            menu={
              <Menu padding={0} style={{maxWidth: 350, minWidth: 250, overflowY: 'hidden'}}>
                <Flex direction="column" paddingX={4} paddingTop={4} paddingBottom={4}>
                  <Flex align="center">
                    {brand.icon ?? (brand.logo && <Logo logo={brand.logo} size="large" />)}
                    <Flex direction="column" gap={2} marginLeft={2}>
                      {brand.project && (
                        <Text size={0} as="div">
                          {brand.project}
                        </Text>
                      )}
                      <Text size={2} weight="medium" as="div">
                        {brand.title}
                      </Text>
                    </Flex>
                  </Flex>
                  {manageUrl && (
                    // Borderless, as the Studio draws them. Its `--card-border-color: unset` is
                    // for its own button; on this Sanity UI it would draw a border instead.
                    <Flex justify="flex-start" gap={3} paddingTop={4}>
                      <Button
                        as="a"
                        href={manageUrl}
                        target="_blank"
                        rel="noopener"
                        mode="bleed"
                        gap={2}
                        padding={2}
                        icon={CogIcon}
                        text="Manage project"
                      />
                      <Button
                        as="a"
                        href={`${manageUrl}/members?invite=true`}
                        target="_blank"
                        rel="noopener"
                        mode="bleed"
                        gap={2}
                        padding={2}
                        icon={AddUserIcon}
                        text="Invite members"
                      />
                    </Flex>
                  )}
                </Flex>
              </Menu>
            }
          />
        </span>
      </StudioTooltip>
    </span>
  )
}
