import { describe, expect, it, vi } from "vitest";
import { EmailSender, type SmtpConfig } from "./auth.js";

const smtp: SmtpConfig = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "auth@example.test",
  password: "secret",
  from: "auth@example.test"
};

describe("EmailSender", () => {
  it("logs the code in development when SMTP is not configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const sender = new EmailSender(false);
    await sender.sendAuthenticationCode("rider@example.test", "123456");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("123456"));
    info.mockRestore();
  });

  it("throws in production when SMTP is not configured", async () => {
    const sender = new EmailSender(true);
    await expect(sender.sendAuthenticationCode("rider@example.test", "123456")).rejects.toThrow();
  });

  it("sends mail through the SMTP transport when configured", async () => {
    const sender = new EmailSender(true, smtp);
    const sendMail = vi.fn().mockResolvedValue({});
    Reflect.set(sender, "transport", { sendMail });
    await sender.sendAuthenticationCode("rider@example.test", "123456");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.from).toBe(smtp.from);
    expect(message.to).toBe("rider@example.test");
    expect(message.text).toContain("123456");
  });

  it("sends security notifications through the SMTP transport when configured", async () => {
    const sender = new EmailSender(true, smtp);
    const sendMail = vi.fn().mockResolvedValue({});
    Reflect.set(sender, "transport", { sendMail });
    await sender.sendSecurityNotification("rider@example.test", "A new passkey was added.");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].text).toContain("passkey");
  });
});
