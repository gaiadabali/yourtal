"use client";

import type { InteractionDetails } from "@yourtal/contracts/oidc/interaction";
import { ConnectConsentView } from "./connect-consent-view";
import { ConnectRefusedView } from "./connect-refused-view";
import { ConnectSendView } from "./connect-send-view";
import { ConnectSignInAgainView } from "./connect-sign-in-again-view";
import { ConnectSignInView } from "./connect-sign-in-view";
import { ConnectTeenConsentView } from "./connect-teen-consent-view";
import { ConnectVerifyView } from "./connect-verify-view";

export interface ConnectScreenProps {
  details: InteractionDetails;
}

/** One view per `screen` the interaction API names (docs/26 §1.1). */
export function ConnectScreen({ details }: ConnectScreenProps) {
  switch (details.screen) {
    case "login":
    case "create":
      return <ConnectSignInView details={details} />;
    case "verify_email":
      return <ConnectVerifyView details={details} />;
    case "sign_in_again":
      return <ConnectSignInAgainView details={details} />;
    case "consent":
      return details.teenInvite === null ? (
        <ConnectConsentView details={details} mode="consent" />
      ) : (
        <ConnectTeenConsentView details={details} parent={details.teenInvite.parentName} />
      );
    case "continue":
      return <ConnectConsentView details={details} mode="continue" />;
    case "send":
      return <ConnectSendView details={details} />;
    case "refused":
      return <ConnectRefusedView details={details} />;
  }
}
