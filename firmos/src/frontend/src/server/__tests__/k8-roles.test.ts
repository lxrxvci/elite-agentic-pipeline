import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { contactClientLinks, contacts } from "@/db/schema";
import { convertIntakeToClient } from "@/server/convert";
import { createIntake, submitIntakeForReview, updateIntake, type IntakePatch, markIntakeAccepted, } from "@/server/intake";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * K8 (B4, 09_30 00:06:12): a custom role from the contact_roles database
 * ("Office manager") rides through conversion - the enum folds to `related`
 * for logic and the firm's wording lands in role_label. Core labels fold to
 * their enum values with no label row.
 */

const reachable = await dbReachable();

function intakeWithRoles(): IntakePatch {
  return {
    legalName: "Role Test LLC",
    formData: {
      contacts: [
        {
          firstName: "Wren",
          lastName: "Okafor",
          email: "wren@roletest.io",
          isPrimary: false,
          relationshipType: "Office manager",
        },
        {
          firstName: "Sal",
          lastName: "Vega",
          email: "sal@roletest.io",
          isPrimary: true,
          relationshipType: "primary_contact",
        },
      ],
      owners: [{ name: "Sal Vega", email: "sal@roletest.io", ownershipPercent: 100 }],
      engagementType: "consulting",
      quickbooksStatus: "none",
    },
  } as IntakePatch;
}

describe.skipIf(!reachable)("custom roles convert with their labels (B4)", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
  });

  it("custom_role_converts_to_related_with_role_label; core labels fold clean", async () => {
    const mgr = (
      await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "dana@blueledgerbooks.com") })
    )!;
    const bk = (
      await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, "sofia@blueledgerbooks.com") })
    )!;

    const row = await createIntake(intakeWithRoles());
    await updateIntake(row.id, {});
    await submitIntakeForReview(row.id);
    // L6 (I3): conversion requires the accepted state first.
    await markIntakeAccepted(row.id);
    const result = await convertIntakeToClient(row.id, { managerId: mgr.id, bookkeeperId: bk.id }, mgr.id, TEST_TODAY);

    const wren = (await db.select().from(contacts).where(eq(contacts.email, "wren@roletest.io")))[0];
    const wrenLink = (
      await db
        .select()
        .from(contactClientLinks)
        .where(eq(contactClientLinks.contactId, wren.id))
    )[0];
    expect(wrenLink.relationshipType).toBe("related");
    expect(wrenLink.roleLabel).toBe("Office manager");

    const sal = (await db.select().from(contacts).where(eq(contacts.email, "sal@roletest.io")))[0];
    const salLinks = await db
      .select()
      .from(contactClientLinks)
      .where(eq(contactClientLinks.contactId, sal.id));
    const primary = salLinks.find((l) => l.relationshipType === "primary_contact" && l.clientId === result.clientId);
    expect(primary).toBeTruthy();
    expect(primary!.roleLabel).toBeNull();
  });
});
