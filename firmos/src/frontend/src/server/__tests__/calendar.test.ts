import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditEvents, clients, correspondence, invoiceLineItems, invoices, meetings, tasks, users } from "@/db/schema";
import { getCalendarDay, getCalendarRange } from "@/server/calendar";
import {
  MeetingError,
  createMeeting,
  deleteMeeting,
  emailMeetingInfo,
  updateMeeting,
} from "@/server/meetings";
import { generateMonthlyInvoices, getPendingBillableMeetings } from "@/server/invoices";
import { seedDatabase } from "@/server/seed";

import { TEST_TODAY, clientIdByName, dbReachable } from "./helpers";

/**
 * Phase 3C calendar + billable meetings: the range read (work items by due
 * date + meetings by firm-local day), meeting CRUD/validation, the "email the
 * client" action through the correspondence engine, and the §6.5 invoice-run
 * pickup (idempotent, unpriced = 0.00 + "No price set" contract).
 */
const reachable = await dbReachable();

/** Midday-UTC instants are the same firm-local day in America/New_York. */
const AT = (day: string, hourUtc = 17) => new Date(`${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`);

describe.skipIf(!reachable)("calendar + meetings (Phase 3C)", () => {
  let ownerId: number;
  let harborlineId: number;

  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.email, "mara@blueledgerbooks.com"))
      .limit(1);
    ownerId = owner.id;
    const clientRows = await db.select().from(clients);
    harborlineId = clientIdByName(clientRows, "Harborline Marine Supply");
  });

  describe("meeting engine", () => {
    it("validates title, times, and the billable-needs-client rule", async () => {
      await expect(
        createMeeting(ownerId, { title: "  ", startsAt: AT("2026-08-10"), endsAt: AT("2026-08-10", 18) }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createMeeting(ownerId, { title: "Bad order", startsAt: AT("2026-08-10", 18), endsAt: AT("2026-08-10") }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createMeeting(ownerId, {
          title: "No client",
          startsAt: AT("2026-08-10"),
          endsAt: AT("2026-08-10", 18),
          billable: true,
          amount: "100.00",
        }),
      ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("needs a client") });
      await expect(
        createMeeting(ownerId, {
          title: "Bad amount",
          clientId: harborlineId,
          startsAt: AT("2026-08-10"),
          endsAt: AT("2026-08-10", 18),
          billable: true,
          amount: "lots",
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("creates, updates, and deletes an internal meeting", async () => {
      const created = await createMeeting(ownerId, {
        title: "Firm all-hands",
        startsAt: AT("2026-08-12"),
        endsAt: AT("2026-08-12", 18),
        location: "Conference room",
      });
      expect(created.clientId).toBeNull();
      expect(created.billable).toBe(false);

      const updated = await updateMeeting(ownerId, created.id, {
        title: "Firm all-hands (moved)",
        startsAt: AT("2026-08-13"),
        endsAt: AT("2026-08-13", 18),
      });
      expect(updated.title).toContain("moved");

      await deleteMeeting(ownerId, created.id);
      expect((await db.select().from(meetings).where(eq(meetings.id, created.id))).length).toBe(0);

      const audit = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityType, "meeting"), eq(auditEvents.entityId, created.id)))
        .orderBy(asc(auditEvents.id));
      expect(audit.map((a) => a.action)).toEqual(["meeting_created", "meeting_updated", "meeting_deleted"]);
    });

    it("refuses to delete an invoiced meeting", async () => {
      const created = await createMeeting(ownerId, {
        title: "Invoiced fixture",
        clientId: harborlineId,
        startsAt: AT("2026-08-03"),
        endsAt: AT("2026-08-03", 18),
        billable: true,
        amount: "75.00",
      });
      await db.update(meetings).set({ billedInvoiceId: 1 }).where(eq(meetings.id, created.id));
      await expect(deleteMeeting(ownerId, created.id)).rejects.toMatchObject({ status: 409 });
      await db.delete(meetings).where(eq(meetings.id, created.id));
    });
  });

  describe("calendar range read", () => {
    it("groups work items by due date and meetings by firm-local day", async () => {
      // Fixture work: one open + one completed task due the same day - the
      // completed one must NOT appear (queue semantics).
      await db.insert(tasks).values([
        { clientId: harborlineId, title: "Calendar fixture open task", dueDate: "2026-08-12" },
        {
          clientId: harborlineId,
          title: "Calendar fixture done task",
          dueDate: "2026-08-12",
          status: "completed",
          completedAt: AT("2026-08-11"),
        },
      ]);
      // 2026-08-12 01:00 UTC is still Aug 11 in America/New_York - the meeting
      // must land on the FIRM-LOCAL day, not the UTC day.
      const evening = await createMeeting(ownerId, {
        title: "Evening review",
        clientId: harborlineId,
        startsAt: new Date("2026-08-12T01:00:00Z"),
        endsAt: new Date("2026-08-12T02:00:00Z"),
      });

      const days = await getCalendarRange(
        { year: 2026, month: 8, day: 1 },
        { year: 2026, month: 8, day: 31 },
      );
      expect(days.length).toBe(31);
      expect(days[0].date).toBe("2026-08-01");
      expect(days[30].date).toBe("2026-08-31");

      const aug11 = days.find((d) => d.date === "2026-08-11")!;
      expect(aug11.meetings.map((m) => m.id)).toContain(evening.id);

      const aug12 = days.find((d) => d.date === "2026-08-12")!;
      const titles = aug12.workItems.map((w) => w.title);
      expect(titles).toContain("Calendar fixture open task");
      expect(titles).not.toContain("Calendar fixture done task");
      // Seeded operational rows (feeds/recons/reports/tasks) land by due date.
      expect(aug12.workItems.every((w) => w.dueDate === "2026-08-12")).toBe(true);
      expect(aug12.workItems.every((w) => w.clientName.length > 0)).toBe(true);

      // The single-day drill reads the same day.
      const drill = await getCalendarDay({ year: 2026, month: 8, day: 11 });
      expect(drill.meetings.map((m) => m.id)).toContain(evening.id);

      await deleteMeeting(ownerId, evening.id);
    });

    // L6 (I4, 10_06 00:59:13): "toggle by employee essentially that's
    // assigned to that task" - the calendar filters work items to one
    // assignee; meetings are shared and stay visible.
    it("calendar_toggles_by_employee", async () => {
      const staffRows = await db.select().from(users);
      const jorge = staffRows.find((u) => u.email === "jorge@blueledgerbooks.com")!;
      const sofia = staffRows.find((u) => u.email === "sofia@blueledgerbooks.com")!;
      await db.insert(tasks).values([
        { clientId: harborlineId, title: "Jorge's fixture task", dueDate: "2026-08-13", assigneeId: jorge.id },
        { clientId: harborlineId, title: "Sofia's fixture task", dueDate: "2026-08-13", assigneeId: sofia.id },
      ]);
      const meeting = await createMeeting(ownerId, {
        title: "Shared review",
        clientId: harborlineId,
        startsAt: AT("2026-08-13"),
        endsAt: AT("2026-08-13", 18),
      });

      const day = { year: 2026, month: 8, day: 13 };
      const all = await getCalendarRange(day, day);
      const allTitles = all[0].workItems.map((w) => w.title);
      expect(allTitles).toContain("Jorge's fixture task");
      expect(allTitles).toContain("Sofia's fixture task");

      const jorgeOnly = await getCalendarRange(day, day, { assigneeId: jorge.id });
      const jorgeTitles = jorgeOnly[0].workItems.map((w) => w.title);
      expect(jorgeTitles).toContain("Jorge's fixture task");
      expect(jorgeTitles).not.toContain("Sofia's fixture task");
      // Meetings are not assignment-filtered.
      expect(jorgeOnly[0].meetings.map((m) => m.id)).toContain(meeting.id);

      // The day drill honors the same filter.
      const drill = await getCalendarDay(day, { assigneeId: sofia.id });
      expect(drill.workItems.map((w) => w.title)).toContain("Sofia's fixture task");
      expect(drill.workItems.map((w) => w.title)).not.toContain("Jorge's fixture task");

      await deleteMeeting(ownerId, meeting.id);
    });
  });

  describe("email the client the meeting info", () => {
    it("sends through the correspondence engine and records the row", async () => {
      const meeting = await createMeeting(ownerId, {
        title: "August close review",
        clientId: harborlineId,
        startsAt: AT("2026-08-14"),
        endsAt: AT("2026-08-14", 18),
        link: "https://meet.google.com/abc-defg-hij",
      });
      const result = await emailMeetingInfo(meeting.id, ownerId, AT("2026-08-10", 12));
      expect(result.sent).toBe(true);

      const [row] = await db
        .select()
        .from(correspondence)
        .where(eq(correspondence.id, (result as { correspondenceId: number }).correspondenceId))
        .limit(1);
      expect(row.template).toBe("meeting_info");
      expect(row.clientId).toBe(harborlineId);
      expect(row.toEmail).toBe("alison@harborlinemarine.com");
      expect(row.subject).toContain("August close review");
      expect(row.bodyText).toContain("https://meet.google.com/abc-defg-hij");
      expect(row.status).toBe("sent");

      const audit = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "meeting_info_emailed"), eq(auditEvents.entityId, meeting.id)));
      expect(audit.length).toBe(1);
      await deleteMeeting(ownerId, meeting.id);
    });

    it("reports no_client / no_contact_email instead of throwing", async () => {
      const internal = await createMeeting(ownerId, {
        title: "Internal sync",
        startsAt: AT("2026-08-14"),
        endsAt: AT("2026-08-14", 18),
      });
      expect(await emailMeetingInfo(internal.id, ownerId)).toEqual({ sent: false, reason: "no_client" });

      // Northwind Frame & Door has no linked contact with an email in the seed.
      const clientRows = await db.select().from(clients);
      const northwindId = clientIdByName(clientRows, "Northwind Frame & Door");
      const noContact = await createMeeting(ownerId, {
        title: "Kickoff",
        clientId: northwindId,
        startsAt: AT("2026-08-14"),
        endsAt: AT("2026-08-14", 18),
      });
      expect(await emailMeetingInfo(noContact.id, ownerId)).toEqual({
        sent: false,
        reason: "no_contact_email",
      });
      await deleteMeeting(ownerId, internal.id);
      await deleteMeeting(ownerId, noContact.id);
    });

    it("404s on a missing meeting", async () => {
      await expect(emailMeetingInfo(999999, ownerId)).rejects.toBeInstanceOf(MeetingError);
    });
  });

  describe("invoice pickup (§6.5 mirror)", () => {
    it("attaches happened billable meetings, stamps them, and never double-bills", async () => {
      // Legacy-branch fixture client: flat monthly amount keeps the invoice
      // non-empty so the meeting lines ride along.
      const [fixture] = await db
        .insert(clients)
        .values({
          legalName: "Meeting Billing Fixture",
          bookkeepingFrequency: "monthly",
          billingFrequency: "monthly",
          monthlyRecurringAmount: "100.00",
          bookkeepingStartDate: "2026-01-01",
        })
        .returning();

      const priced = await createMeeting(ownerId, {
        title: "Priced consult",
        clientId: fixture.id,
        startsAt: AT("2026-08-10"),
        endsAt: AT("2026-08-10", 18),
        billable: true,
        amount: "150.00",
      });
      const unpriced = await createMeeting(ownerId, {
        title: "Unpriced consult",
        clientId: fixture.id,
        startsAt: AT("2026-08-11"),
        endsAt: AT("2026-08-11", 18),
        billable: true,
      });
      // Future (after TEST_TODAY 2026-08-15): must NOT invoice yet.
      const future = await createMeeting(ownerId, {
        title: "Future consult",
        clientId: fixture.id,
        startsAt: AT("2026-08-20"),
        endsAt: AT("2026-08-20", 18),
        billable: true,
        amount: "200.00",
      });

      // The pending queue: both happened meetings, unpriced carries null.
      const pendingBefore = await getPendingBillableMeetings(fixture.id, TEST_TODAY);
      expect(pendingBefore.map((p) => p.meetingId).sort()).toEqual([priced.id, unpriced.id].sort());
      expect(pendingBefore.find((p) => p.meetingId === unpriced.id)?.amount).toBeNull();

      const summary = await generateMonthlyInvoices(2026, 8, TEST_TODAY);
      expect(summary.meetingsAttached).toBe(2);

      const [invoice] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.clientId, fixture.id), eq(invoices.year, 2026), eq(invoices.month, 8)))
        .limit(1);
      const lines = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoice.id))
        .orderBy(invoiceLineItems.position);
      const meetingLines = lines.filter((l) => l.description.startsWith("Billable meeting:"));
      expect(meetingLines.length).toBe(2);
      expect(meetingLines[0].description).toBe("Billable meeting: Priced consult (Aug 10, 2026)");
      expect(meetingLines[0].amount).toBe("150.00");
      expect(meetingLines[0].lineType).toBe("other");
      // Unpriced bills 0.00 (flagged "No price set" on the pending queue).
      expect(meetingLines[1].description).toBe("Billable meeting: Unpriced consult (Aug 11, 2026)");
      expect(meetingLines[1].amount).toBe("0.00");
      expect(invoice.total).toBe("250.00"); // 100 legacy + 150 + 0

      // Stamped; the future meeting is untouched.
      const rows = await db.select().from(meetings).where(eq(meetings.clientId, fixture.id));
      expect(rows.find((r) => r.id === priced.id)?.billedInvoiceId).toBe(invoice.id);
      expect(rows.find((r) => r.id === unpriced.id)?.billedInvoiceId).toBe(invoice.id);
      expect(rows.find((r) => r.id === future.id)?.billedInvoiceId).toBeNull();

      // Idempotent rerun: the client already has a generated August invoice
      // and the meetings are stamped - nothing changes. The future meeting
      // is not pending yet (it has not happened) and stays unstamped.
      const rerun = await generateMonthlyInvoices(2026, 8, TEST_TODAY);
      expect(rerun.meetingsAttached).toBe(0);
      expect((await getPendingBillableMeetings(fixture.id, TEST_TODAY)).length).toBe(0);
      const futureRow = await db.select().from(meetings).where(eq(meetings.id, future.id)).limit(1);
      expect(futureRow[0].billedInvoiceId).toBeNull();
    });
  });
});
