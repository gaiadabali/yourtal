import type { BusinessMember } from "@yourtal/contracts/business/member";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { TeamRoleBadge } from "./team-role-badge";

export interface TeamRosterRow {
  member: BusinessMember;
  name: string;
  email: string;
}

export interface TeamRosterTableProps {
  rows: readonly TeamRosterRow[];
  currentUserId: string;
  /** Whether the signed-in viewer is this business's Owner — only the Owner sees "Transfer ownership" (`policies/resource_policies/team.yaml`'s `only-the-owner-transfers-or-deletes`). */
  viewerIsOwner: boolean;
  onChangeRole: (targetUserId: string) => void;
  onRemove: (targetUserId: string) => void;
  onTransferOwnership: () => void;
}

/**
 * The Team roster. Every row a plain member gets Change role / Remove
 * actions; the Owner row gets neither — only "Transfer ownership", and
 * only when the viewer themselves is the Owner
 * (`ownership-moves-only-by-transfer`: the Owner can never be reached
 * through `change_role` or `remove_member` at all, so those two actions
 * are not merely disabled on that row, they do not exist there).
 */
export function TeamRosterTable({
  rows,
  currentUserId,
  viewerIsOwner,
  onChangeRole,
  onRemove,
  onTransferOwnership,
}: TeamRosterTableProps) {
  return (
    <table className="w-full min-w-0 border-collapse text-left text-sm font-sans">
      <thead>
        <tr className="border-b border-border-strong text-fg-muted">
          <th scope="col" className="py-2 pr-2 font-medium">
            Member
          </th>
          <th scope="col" className="py-2 pr-2 font-medium">
            Role
          </th>
          <th scope="col" className="py-2 pr-2 font-medium">
            Status
          </th>
          <th scope="col" className="py-2 font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ member, name, email }) => {
          const isSelf = member.userId === currentUserId;
          const isOwnerRow = member.role === "owner";
          return (
            <tr key={member.userId} className="border-b border-border last:border-b-0">
              <td className="py-3 pr-2">
                <div className="flex flex-col">
                  <span className="font-medium text-fg">
                    {name}
                    {isSelf ? " (you)" : ""}
                  </span>
                  <span className="text-xs text-fg-subtle">{email}</span>
                </div>
              </td>
              <td className="py-3 pr-2">
                <TeamRoleBadge role={member.role} />
              </td>
              <td className="py-3 pr-2">
                {member.joinedAt ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="warning">Pending invite</Badge>
                )}
              </td>
              <td className="py-3">
                {isOwnerRow ? (
                  viewerIsOwner ? (
                    <Button type="button" variant="outline" size="sm" onClick={onTransferOwnership}>
                      Transfer ownership
                    </Button>
                  ) : (
                    <span className="text-xs text-fg-subtle">Owner &mdash; transfer only</span>
                  )
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onChangeRole(member.userId)}
                    >
                      Change role
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onRemove(member.userId)}
                    >
                      {isSelf ? "Remove me" : "Remove"}
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
