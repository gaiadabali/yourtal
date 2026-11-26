import { type AddressInfo, type Server, type Socket, createServer } from "node:net";

/**
 * A minimal in-process SMTP server for the SMTP driver's tests, over a real
 * socket (there is no `smtp-server` dependency in this repo). It never offers
 * STARTTLS, which is exactly what lets the tests prove the driver refuses to
 * send in the clear, and, with `EMAIL_SMTP_ALLOW_INSECURE` in dev, that a send
 * and its recipient really reach a relay. Test code only.
 */

export interface TestSmtpServer {
  readonly port: number;
  /** Every recipient the server was asked to accept (RCPT TO). */
  readonly recipients: string[];
  /** Every full message body received (headers included), in order. */
  readonly messages: string[];
  /** Every command line received before DATA, for "nothing sensitive was sent" assertions. */
  readonly commands: string[];
  close(): Promise<void>;
}

export type TestSmtpReply = (rcpt: string) => string | undefined;

/** `rejectRcpt` can answer RCPT TO with an error line such as `550 no such user`. */
export async function startTestSmtpServer(
  options: { rejectRcpt?: TestSmtpReply } = {},
): Promise<TestSmtpServer> {
  const recipients: string[] = [];
  const messages: string[] = [];
  const commands: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.write("220 test.local ESMTP\r\n");
    let buffer = "";
    let inData = false;
    let body = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(body);
            body = "";
            socket.write("250 2.0.0 queued\r\n");
          } else {
            body += `${line}\r\n`;
          }
          continue;
        }
        commands.push(line);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO") socket.write("250-test.local\r\n250 8BITMIME\r\n");
        else if (verb === "MAIL") socket.write("250 2.1.0 ok\r\n");
        else if (verb === "RCPT") {
          const rcpt = /<([^>]*)>/.exec(line)?.[1] ?? "";
          const refusal = options.rejectRcpt?.(rcpt);
          if (refusal === undefined) {
            recipients.push(rcpt);
            socket.write("250 2.1.5 ok\r\n");
          } else {
            socket.write(`${refusal}\r\n`);
          }
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else if (verb === "RSET" || verb === "NOOP") {
          socket.write("250 ok\r\n");
        } else {
          // STARTTLS and anything else: a server that does not support it says so.
          socket.write("502 5.5.1 command not implemented\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    recipients,
    messages,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
