/**
 * Who's online in the Studio, as an avatar stack beside the bar's actions (the Studio navbar's
 * presence menu shows the same people). People with this page's document open get the Studio's
 * editing ring and come first. Drawn with the bar's own Sanity UI from plain user data.
 */
import {Avatar, AvatarStack} from '@sanity/ui'

import type {PresenceUser} from './StudioLayer'
import {StudioTooltip} from './StudioTooltip'

const COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'magenta', 'purple'] as const

/** A stable avatar colour per user, like the Studio's user colour manager. */
function colorOf(id: string) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
}

/** "Alex", "Alex and Sam", "Alex, Sam and Kim". */
function listNames(names: string[]) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function PresenceStack({
  users,
  pageEditors = [],
  onHoverChange,
}: {
  users: PresenceUser[]
  /** People with this page's document open in the Studio: they get the editing ring. */
  pageEditors?: PresenceUser[]
  onHoverChange: (hovered: boolean) => void
}) {
  if (users.length === 0) return null
  const editing = new Set(pageEditors.map((user) => user.id))
  const ordered = [
    ...users.filter((user) => editing.has(user.id)),
    ...users.filter((user) => !editing.has(user.id)),
  ]
  const nameOf = (user: PresenceUser) => user.name || 'Unknown user'
  const editorNames = ordered.filter((user) => editing.has(user.id)).map(nameOf)
  const onlineNames = ordered.filter((user) => !editing.has(user.id)).map(nameOf)
  const label = [
    editorNames.length > 0 &&
      `${listNames(editorNames)} ${editorNames.length === 1 ? 'is' : 'are'} editing this page`,
    onlineNames.length > 0 &&
      `${listNames(onlineNames)} ${onlineNames.length === 1 ? 'is' : 'are'} online`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      style={{display: 'flex', alignItems: 'center', paddingInline: 4}}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <StudioTooltip content={label}>
        <span style={{display: 'flex'}} aria-label={label} role="img">
          <AvatarStack maxLength={4} size={0}>
            {ordered.map((user) => (
              <Avatar
                key={user.id}
                src={user.imageUrl}
                initials={initialsOf(user.name)}
                color={colorOf(user.id)}
                status={editing.has(user.id) ? 'editing' : 'online'}
                size={0}
                title={user.name}
              />
            ))}
          </AvatarStack>
        </span>
      </StudioTooltip>
    </span>
  )
}
