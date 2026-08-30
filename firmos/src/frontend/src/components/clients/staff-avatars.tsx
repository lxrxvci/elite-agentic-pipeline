import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { StaffRef } from '@/server/clients'
import { avatarStyle } from '@/shared/lib/avatar-hue'

/**
 * Profile-header staff cluster. Assigned staff render as initial avatars;
 * unassigned slots render a subtle dashed placeholder labeled "Unassigned"
 * (conversion no longer requires staff - assignment is a post-conversion
 * admin action on the client record).
 */

function HeaderAvatar({ person, role }: { person: StaffRef; role: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[11px] font-semibold" style={avatarStyle(person.id)}>
              <span className="sr-only">{`${role}: ${person.name}`}</span>
              <span aria-hidden>{person.initials}</span>
            </AvatarFallback>
          </Avatar>
        </span>
      </TooltipTrigger>
      <TooltipContent>{`${role}: ${person.name}`}</TooltipContent>
    </Tooltip>
  )
}

function UnassignedAvatar({ role }: { role: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <Avatar
            className="h-7 w-7 border border-dashed border-border bg-transparent"
            data-testid={`unassigned-${role.toLowerCase()}`}
          >
            <AvatarFallback className="bg-transparent text-[11px] font-medium text-muted-foreground">
              <span className="sr-only">{`${role}: Unassigned`}</span>
              <span aria-hidden>-</span>
            </AvatarFallback>
          </Avatar>
        </span>
      </TooltipTrigger>
      <TooltipContent>{`${role}: Unassigned`}</TooltipContent>
    </Tooltip>
  )
}

export function StaffAvatars({
  manager,
  bookkeeper,
}: {
  manager: StaffRef | null
  bookkeeper: StaffRef | null
}) {
  return (
    <div className="flex items-center -space-x-1.5">
      {manager ? (
        <HeaderAvatar person={manager} role="Manager" />
      ) : (
        <UnassignedAvatar role="Manager" />
      )}
      {bookkeeper ? (
        <HeaderAvatar person={bookkeeper} role="Bookkeeper" />
      ) : (
        <UnassignedAvatar role="Bookkeeper" />
      )}
    </div>
  )
}
