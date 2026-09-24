import { eq } from "drizzle-orm";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { appSettings, notifications, users } from "@/db/schema";
import { emitNotification, emitOncePerDay } from "@/server/notifications";
import { postSlackNotification, slackText } from "@/server/slack";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, dbReachable } from "./helpers";

/**
 * Phase 3C Slack bridge pins: posts fire on the right notification types,
 * §9 dedup is inherited (no row = no post), the slack_enabled flag gates
 * everything, and a failing webhook never breaks the notification path.
 */
const reachable = await dbReachable();

interface CapturedPost {
  text: string;
}

async function withStubWebhook(
  handler: (body: CapturedPost) => { status: number },
): Promise<{ url: string; posts: CapturedPost[]; close: () => Promise<void> }> {
  const posts: CapturedPost[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      posts.push(JSON.parse(body) as CapturedPost);
      const { status } = handler(JSON.parse(body) as CapturedPost);
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/webhook`,
    posts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function setSlackEnabled(enabled: boolean): Promise<void> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "feature_flags"))
    .limit(1);
  const current = (row?.value as Record<string, unknown> | undefined) ?? {};
  await db
    .insert(appSettings)
    .values({ key: "feature_flags", value: { ...current, slack_enabled: enabled } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { ...current, slack_enabled: enabled } },
    });
}

describe.skipIf(!reachable)("slack notification bridge (Phase 3C)", () => {
  let maraId: number;
  const savedUrl = process.env.SLACK_WEBHOOK_URL;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [mara] = await db
      .select()
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    maraId = mara.id;
  });

  afterEach(async () => {
    if (savedUrl === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = savedUrl;
    await setSlackEnabled(false);
  });

  afterAll(async () => {
    await db.delete(notifications);
  });

  it("posts bridged types to the webhook when the flag is on", async () => {
    const stub = await withStubWebhook(() => ({ status: 200 }));
    process.env.SLACK_WEBHOOK_URL = stub.url;
    await setSlackEnabled(true);
    try {
      const row = await emitNotification({
        userId: maraId,
        type: "chat_mention",
        title: "Dana Whitfield mentioned you in #general",
        message: "can you look at the Harborline recon?",
        link: "/messages?channel=3",
      });
      expect(row.id).toBeGreaterThan(0);
      expect(stub.posts.length).toBe(1);
      expect(stub.posts[0].text).toContain("*Dana Whitfield mentioned you in #general*");
      expect(stub.posts[0].text).toContain("can you look at the Harborline recon?");
      expect(stub.posts[0].text).toContain("/messages?channel=3");
    } finally {
      await stub.close();
    }
  });

  it("does not post types outside the bridge set", async () => {
    const stub = await withStubWebhook(() => ({ status: 200 }));
    process.env.SLACK_WEBHOOK_URL = stub.url;
    await setSlackEnabled(true);
    try {
      await emitNotification({ userId: maraId, type: "task_overdue", title: "Overdue: reconcile" });
      expect(stub.posts.length).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("respects the §9 dedup wrappers (no second post for a deduped row)", async () => {
    const stub = await withStubWebhook(() => ({ status: 200 }));
    process.env.SLACK_WEBHOOK_URL = stub.url;
    await setSlackEnabled(true);
    const input = {
      userId: maraId,
      type: "not_clocked_in",
      title: "Jorge Medina hasn't clocked in",
      entityType: "user",
      entityId: 42,
    };
    try {
      const first = await emitOncePerDay(input);
      const second = await emitOncePerDay(input);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(stub.posts.length).toBe(1);
    } finally {
      await stub.close();
    }
  });

  it("posts nothing when the slack_enabled flag is off", async () => {
    const stub = await withStubWebhook(() => ({ status: 200 }));
    process.env.SLACK_WEBHOOK_URL = stub.url;
    await setSlackEnabled(false);
    try {
      await emitNotification({ userId: maraId, type: "client_reply", title: "Reply from Alison" });
      expect(stub.posts.length).toBe(0);
    } finally {
      await stub.close();
    }
  });

  it("a webhook failure (500) never breaks the notification path", async () => {
    const stub = await withStubWebhook(() => ({ status: 500 }));
    process.env.SLACK_WEBHOOK_URL = stub.url;
    await setSlackEnabled(true);
    try {
      const row = await emitNotification({
        userId: maraId,
        type: "bumper_override_requested",
        title: "Override requested",
      });
      expect(row.id).toBeGreaterThan(0);
      expect(stub.posts.length).toBe(1); // attempted, logged, swallowed
    } finally {
      await stub.close();
    }
  });

  it("an unreachable webhook never breaks the notification path", async () => {
    // Nothing listens on this port.
    process.env.SLACK_WEBHOOK_URL = "http://127.0.0.1:1/webhook";
    await setSlackEnabled(true);
    const row = await emitNotification({
      userId: maraId,
      type: "chat_mention",
      title: "Offline webhook",
    });
    expect(row.id).toBeGreaterThan(0);
  });

  it("no webhook URL means no post attempt (dev driver / prod no-op)", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    await setSlackEnabled(true);
    const attempted = await postSlackNotification({ type: "client_reply", title: "x" });
    expect(attempted).toBe(false);
  });

  it("slackText formats title, body, and an absolute FirmOS link", () => {
    const text = slackText({
      type: "chat_mention",
      title: "Mention",
      message: "hello",
      link: "/messages",
    });
    expect(text).toBe(
      "*Mention*\nhello\n<http://localhost:3000/messages|Open in FirmOS>",
    );
  });
});
