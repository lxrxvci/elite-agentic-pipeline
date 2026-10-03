import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { clientIntakes, contactClientLinks, contacts } from "@/db/schema";
import { convertIntakeToClient } from "@/server/convert";
import { createIntake, submitIntakeForReview, updateIntake, type IntakePatch } from "@/server/intake";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K4 (B10, 09_30 00:07:51): "same person connected to multiple businesses -
 * we have five different contacts with the same name" is the failure Jason
 * is paying to never see. One person across two intakes = ONE contact
 * record with a link per client.
 */

const reachable = await dbReachable();

function intakeFor(legalName: string): IntakePatch {
  return {
    legalName,
    formData: {
      contacts: [
        {
          firstName: "Sal",
          lastName: "Vega",
          entityName: null,
          email: "sal@vega.io",
          phone: "5035550182",
          isPrimary: true,
          relationshipType: "primary_contact",
        },
      ],
      owners: [{ name: "Sal Vega", email: "sal@vega.io", phone: "5035550182", ownershipPercent: 100 }],
      engagementType: "consulting", // consulting: no books-start/scheduler requirements
      quickbooksStatus: "none",
    },
  } as IntakePatch;
}

describe.skipIf(!reachable)("one person, two businesses, one record (B10)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("one_person_two_businesses_one_record", async () => {
    const mgr = (
      await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "dana@blueledgerbooks.com") })
    )!;
    const bk = (
      await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "sofia@blueledgerbooks.com") })
    )!;

    const ids: number[] = [];
    for (const name of ["Vega Holdings LLC", "Vega Pool Service LLC"]) {
      const row = await createIntake(intakeFor(name));
      await updateIntake(row.id, {});
      await submitIntakeForReview(row.id);
      const result = await convertIntakeToClient(row.id, { managerId: mgr.id, bookkeeperId: bk.id }, mgr.id, TEST_TODAY);
      ids.push(result.clientId);
    }

    // ONE Sal Vega contact record total.
    const salRows = await db.select().from(contacts).where(eq(contacts.email, "sal@vega.io"));
    expect(salRows).toHaveLength(1);

    // Linked to BOTH clients, as primary contact and as owner.
    const links = await db
      .select()
      .from(contactClientLinks)
      .where(eq(contactClientLinks.contactId, salRows[0].id));
    const byClient = new Map<number, string[]>();
    for (const l of links) {
      byClient.set(l.clientId, [...(byClient.get(l.clientId) ?? []), l.relationshipType]);
    }
    for (const clientId of ids) {
      expect(byClient.get(clientId)).toEqual(expect.arrayContaining(["primary_contact", "owner"]));
    }

    // Both intakes converted cleanly.
    const rows = await db.select().from(clientIntakes).where(eq(clientIntakes.status, "completed"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
