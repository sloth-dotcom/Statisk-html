import { Resend } from "resend";
import { digestRecipients, env } from "@/lib/env";
import { errorToJson, log } from "@/lib/logger";

export interface DeliveryResult {
  channel: "mail" | "slack";
  sent: boolean;
  /** Why nothing was sent. Never silent — an unconfigured channel is visible on /status. */
  reason?: string;
}

export async function sendEmail(subject: string, html: string, text: string): Promise<DeliveryResult> {
  const config = env();
  const recipients = digestRecipients();

  if (!config.RESEND_API_KEY) return { channel: "mail", sent: false, reason: "RESEND_API_KEY mangler" };
  if (recipients.length === 0) return { channel: "mail", sent: false, reason: "DIGEST_RECIPIENTS er tom" };

  try {
    const resend = new Resend(config.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: config.DIGEST_FROM,
      to: recipients,
      subject,
      html,
      text,
    });
    if (error) {
      log.error("notify.mail_failed", { message: error.message });
      return { channel: "mail", sent: false, reason: error.message };
    }
    log.info("notify.mail_sent", { recipients: recipients.length, subject });
    return { channel: "mail", sent: true };
  } catch (error) {
    const info = errorToJson(error);
    log.error("notify.mail_failed", info);
    return { channel: "mail", sent: false, reason: info.message };
  }
}

export async function sendSlack(text: string): Promise<DeliveryResult> {
  const webhook = env().SLACK_WEBHOOK_URL;
  if (!webhook) return { channel: "slack", sent: false, reason: "SLACK_WEBHOOK_URL mangler" };

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.error("notify.slack_failed", { status: response.status, body: body.slice(0, 500) });
      return { channel: "slack", sent: false, reason: `Slack svarede ${response.status}` };
    }
    log.info("notify.slack_sent", {});
    return { channel: "slack", sent: true };
  } catch (error) {
    const info = errorToJson(error);
    log.error("notify.slack_failed", info);
    return { channel: "slack", sent: false, reason: info.message };
  }
}
