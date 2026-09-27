import { useTranslations } from "next-intl";
import type { BusinessMember } from "@yourtal/contracts/business/member";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { DataTable } from "@yourtal/ui/data-table";
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
  const t = useTranslations("studio");

  return (
    <DataTable
      caption={t("team.roster.caption")}
      rows={[...rows]}
      getRowKey={(row) => row.member.userId}
      columns={[
        {
          key: "member",
          header: t("team.roster.memberHeader"),
          cell: ({ member, name, email }) => (
            <div className="flex flex-col">
              <span className="font-medium text-fg">
                {name}
                {member.userId === currentUserId ? t("team.roster.you") : ""}
              </span>
              <span className="text-xs text-fg-subtle">{email}</span>
            </div>
          ),
        },
        {
          key: "role",
          header: t("team.roster.roleHeader"),
          cell: ({ member }) => <TeamRoleBadge role={member.role} />,
        },
        {
          key: "status",
          header: t("team.roster.statusHeader"),
          cell: ({ member }) =>
            member.joinedAt ? (
              <Badge variant="success">{t("team.roster.active")}</Badge>
            ) : (
              <Badge variant="warning">{t("team.roster.pendingInvite")}</Badge>
            ),
        },
        {
          key: "actions",
          header: <span className="sr-only">{t("team.roster.actionsHeader")}</span>,
          cell: ({ member }) => {
            const isSelf = member.userId === currentUserId;
            const isOwnerRow = member.role === "owner";
            if (isOwnerRow) {
              return viewerIsOwner ? (
                <Button type="button" variant="outline" size="sm" onClick={onTransferOwnership}>
                  {t("team.roster.transferOwnership")}
                </Button>
              ) : (
                <span className="text-xs text-fg-subtle">{t("team.roster.ownerTransferOnly")}</span>
              );
            }
            return (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChangeRole(member.userId)}
                >
                  {t("team.roster.changeRole")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => onRemove(member.userId)}
                >
                  {isSelf ? t("team.remove.confirmSelf") : t("team.remove.confirm")}
                </Button>
              </div>
            );
          },
        },
      ]}
    />
  );
}
