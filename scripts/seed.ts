import { createDb, bnplPlans } from "@farmermarket/db";

// Seeds bnpl_plans from the Dart BnplPlan.allPlans (mobile/lib/features/
// checkout/domain/models/bnpl_plan.dart) so both apps start from the same
// four plans until §14 moves the phone app onto this table (§5.7).
const PLANS = [
  { name: "Pay Now", durationMonths: 0, interestPercent: 0, isPopular: false, sortOrder: 0 },
  { name: "Pay in a month", durationMonths: 1, interestPercent: 0, isPopular: true, sortOrder: 1 },
  { name: "Pay in 2 monthly installments", durationMonths: 2, interestPercent: 2, isPopular: false, sortOrder: 2 },
  { name: "Pay in 3 monthly installments", durationMonths: 3, interestPercent: 5, isPopular: false, sortOrder: 3 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);

  const existing = await db.select().from(bnplPlans);
  let seeded = 0;
  for (const plan of PLANS) {
    if (existing.some(p => !p.testOnly && p.durationDays === null && p.durationMonths === plan.durationMonths)) continue;
    await db.insert(bnplPlans).values(plan);
    seeded++;
  }

  console.log(`Seeded ${seeded} BNPL plans.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
