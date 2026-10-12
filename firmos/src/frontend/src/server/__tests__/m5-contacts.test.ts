import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { contacts, users } from "@/db/schema";
import { convertIntakeToClient } from "@/server/convert";
import {
  createIntake,
  markIntakeAccepted,
  submitIntakeForReview,
  updateIntake,
  type IntakePatch,
} from "@/server/intake";
import { seedDatabase } from "@/server/seed";

import { dbReachable, TEST_TODAY } from "./helpers";

/**
 * M5 (10_10 00:02:57, meeting #5 C2): a contact holds MULTIPLE emails and
 * phones - "different email for each business". Conversion writes the full
 * channel list with the primary scalar first.
 */

const reachable = await dbReachable();

let managerDana: number;

async function reviewableIntake(patch: IntakePatch): Promise<number> {
  const row = await createIntake(patch);
  await updateIntake(row.id, {});
  await submitIntakeForReview(row.id);
  return row.id;
}

describe.skipIf(!reachable)("M5 contact channels at conversion", () => {
  beforeAll(async () => {
    await seedDatabase(TEST_TODAY);
    const [dana] = await db.select().from(users).where(eq(users.email, "dana@blueledgerbooks.com")).limit(1);
    managerDana = dana.id;
  });

  it("contact_holds_multiple_emails_and_phones", async () => {
    const intakeId = await reviewableIntake({
      legalName: "Multi Channel Co",
      bookkeepingFrequency: "monthly",
      bookkeepingStartDate: "2026-01-01",
      formData: {
        serviceKeys: ["bank_feed_management"],
        contacts: [
          {
            firstName: "Wren",
            lastName: "Okafor",
            email: "wren@fern.shop",
            phone: "5035550182",
            // The extras the intake's channel widget captured; the primary
            // scalar stays first and duplicates fold out.
            emails: ["ap@fern.shop", "wren@fern.shop", "owner@fern.shop"],
            phones: ["9715550110"],
            isPrimary: true,
            relationshipType: "primary_contact",
          },
        ],
      },
    });
    await markIntakeAccepted(intakeId);
    const result = await convertIntakeToClient(intakeId, {}, managerDana, TEST_TODAY);

    const rows = await db.select().from(contacts).where(eq(contacts.firstName, "Wren"));
    const wren = rows.find((c) => c.lastName === "Okafor")!;
    expect(wren.email).toBe("wren@fern.shop");
    expect(wren.phone).toBe("5035550182");
    expect(wren.emails).toEqual(["wren@fern.shop", "ap@fern.shop", "owner@fern.shop"]);
    expect(wren.phones).toEqual(["5035550182", "9715550110"]);
    expect(result.clientId).toBeGreaterThan(0);
  });
});
