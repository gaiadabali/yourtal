import { ChannelAvatar } from "@yourtal/ui/channel-avatar";
import type { PublicCharity } from "@yourtal/contracts/charity/charity";

/** The charity's logo, or its initials on a stable colour when it has none. */
export function CharityLogo({
  charity,
  size = "lg",
}: {
  charity: PublicCharity;
  size?: "md" | "lg";
}) {
  return (
    <ChannelAvatar
      decorative
      name={charity.name}
      size={size}
      {...(charity.logoUrl ? { src: charity.logoUrl } : {})}
    />
  );
}
