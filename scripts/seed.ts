import { createDb, bnplPlans } from "@farmermarket/db";

// Seeds bnpl_plans from the Dart BnplPlan.allPlans (mobile/lib/features/
// checkout/domain/models/bnpl_plan.dart) so both apps start from the same
// four plans until §14 moves the phone app onto this table (§5.7).
const PLANS = [
  { name: "Pay Now", durationMonths: 0, interestPercent: 0, isPopular: false, sortOrder: 0 },
  { name: "Pay Next Salary", durationMonths: 1, interestPercent: 0, isPopular: true, sortOrder: 1 },
  { name: "Pay Over 2 Months", durationMonths: 2, interestPercent: 2, isPopular: false, sortOrder: 2 },
  { name: "Pay Over 3 Months", durationMonths: 3, interestPercent: 5, isPopular: false, sortOrder: 3 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);

  for (const plan of PLANS) {
    await db.insert(bnplPlans).values(plan);
  }

  console.log(`Seeded ${PLANS.length} BNPL plans.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
