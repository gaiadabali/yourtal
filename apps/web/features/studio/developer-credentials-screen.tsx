"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  MerchantDeveloperCredential,
  WebhookSubscription,
} from "@yourtal/contracts/merchant/merchant-developer-credential";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { Input } from "@yourtal/ui/input";
import { Switch } from "@yourtal/ui/switch";
import {
  issueCredentialLive,
  registerWebhookLive,
  revokeCredentialLive,
  rotateCredentialLive,
} from "./developer-credentials-data";

export interface DeveloperCredentialsScreenProps {
  businessId: string;
  initialCredentials: readonly MerchantDeveloperCredential[];
  initialWebhook: WebhookSubscription | null;
}

/**
 * TASKS.md 8.3.a: issue/rotate/revoke merchant HMAC credentials, plus the
 * webhook delivery URL (8.3.c's contract). A credential's `secret` is
 * present ONLY in the response to issue/rotate — this screen shows it once,
 * in a dismissible banner, and never again (matches
 * `provisionDeviceResultSchema`'s own "shown once" shape).
 */
export function DeveloperCredentialsScreen({
  businessId,
  initialCredentials,
  initialWebhook,
}: DeveloperCredentialsScreenProps) {
  const t = useTranslations("studio");
  const [credentials, setCredentials] = useState(initialCredentials);
  const [revealedSecret, setRevealedSecret] = useState<{ label: string; secret: string } | null>(
    null,
  );
  const [label, setLabel] = useState("");
  const [sandbox, setSandbox] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState(initialWebhook);
  const [webhookUrl, setWebhookUrl] = useState(initialWebhook?.url ?? "");
  const [webhookError, setWebhookError] = useState<string | null>(null);

  async function handleIssue(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await issueCredentialLive(businessId, { label, sandbox });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setCredentials((current) => [result.data, ...current]);
    if (result.data.secret) {
      setRevealedSecret({ label: result.data.label, secret: result.data.secret });
    }
    setLabel("");
  }

  async function handleRotate(credentialId: string) {
    const result = await rotateCredentialLive(businessId, credentialId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCredentials((current) =>
      current.map((credential) =>
        credential.credentialId === credentialId ? result.data : credential,
      ),
    );
    if (result.data.secret) {
      setRevealedSecret({ label: result.data.label, secret: result.data.secret });
    }
  }

  async function handleRevoke(credentialId: string) {
    const result = await revokeCredentialLive(businessId, credentialId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCredentials((current) =>
      current.map((credential) =>
        credential.credentialId === credentialId ? { ...credential, state: "revoked" } : credential,
      ),
    );
  }

  async function handleWebhookSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await registerWebhookLive(businessId, webhookUrl);
    if (!result.ok) {
      setWebhookError(result.error.message);
      return;
    }
    setWebhookError(null);
    setWebhook(result.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle as="h2">{t("developers.credentials.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {revealedSecret ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning bg-warning/10 p-4">
              <p className="text-sm font-sans font-semibold text-fg">
                {t("developers.credentials.secretRevealed", { label: revealedSecret.label })}
              </p>
              <p className="break-all rounded-lg border border-border bg-surface-sunken p-3 font-mono text-sm text-fg">
                {revealedSecret.secret}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setRevealedSecret(null)}
                className="w-fit"
              >
                {t("developers.credentials.secretDismiss")}
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-sans text-danger">
              {error}
            </p>
          ) : null}
          <form
            onSubmit={(event) => void handleIssue(event)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Input
              label={t("developers.credentials.labelField")}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
              className="sm:flex-1"
            />
            <Switch
              label={t("developers.credentials.sandboxLabel")}
              checked={sandbox}
              onCheckedChange={setSandbox}
            />
            <Button type="submit">{t("developers.credentials.issue")}</Button>
          </form>
          <ul className="flex flex-col gap-2">
            {credentials.map((credential) => (
              <li
                key={credential.credentialId}
                className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="font-sans text-fg">{credential.label}</span>
                  <span className="text-xs text-fg-muted">
                    {credential.sandbox
                      ? t("developers.credentials.sandbox")
                      : t("developers.credentials.live")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={credential.state === "active" ? "success" : "danger"}>
                    {credential.state === "active"
                      ? t("developers.credentials.active")
                      : t("developers.credentials.revoked")}
                  </Badge>
                  {credential.state === "active" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRotate(credential.credentialId)}
                      >
                        {t("developers.credentials.rotate")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleRevoke(credential.credentialId)}
                      >
                        {t("developers.credentials.revoke")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("developers.webhooks.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm font-sans text-fg-muted">{t("developers.webhooks.description")}</p>
          {webhook ? (
            <p className="text-xs font-sans text-fg-subtle">
              {t("developers.webhooks.registered", { url: webhook.url })}
            </p>
          ) : null}
          <form
            onSubmit={(event) => void handleWebhookSubmit(event)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Input
              label={t("developers.webhooks.urlField")}
              type="url"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              required
              className="sm:flex-1"
            />
            <Button type="submit">{t("developers.webhooks.save")}</Button>
          </form>
          {webhookError ? (
            <p role="alert" className="text-xs font-sans text-danger">
              {webhookError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
