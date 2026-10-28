// Runs the isolated workflow without loading .env or any real DB credentials.
// Build apps/api first. No bank/provider traffic is performed by this runner.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const apiRequire = createRequire(resolve(__dirname, "../apps/api/package.json"));
apiRequire("reflect-metadata");
process.env.RECOVA_SANDBOX_ENABLED = "true";
process.env.NODE_ENV = "test";
const { RecovaJourneyService } = apiRequire("./dist/modules/recova/recova-journey.service.js");

(async () => {
  const runner = new RecovaJourneyService();
  try {
    await runner.start("local-practice-report");
    const checkpoints = [];
    let result;
    for (let i = 0; i < 11; i++) {
      result = await runner.advance("local-practice-report");
      checkpoints.push({ step: result.events.at(-1).title, receivedNaira: result.accounting.receivedNaira,
        outstandingNaira: (result.policy?.outstandingKobo ?? 0) / 100, stage: result.policy?.stage ?? "application" });
    }
    const directory = resolve(__dirname, "../output");
    await mkdir(directory, { recursive: true });
    const name = `recova-practice-${Date.now()}`;
    const jsonPath = resolve(directory, `${name}.json`);
    const reportPath = resolve(directory, `${name}.md`);
    await writeFile(jsonPath, JSON.stringify({ ...result, checkpoints }, null, 2));
    const naira = (amount) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount);
    const report = [
      "# Farmer Market — completed practice journey", "",
      "This run used Farmer Market's actual application, checkout, order approval, inventory, repayment and ledger services against an isolated temporary PostgreSQL database. Bank consent and debit results were simulated. No real customer records were created and no Recova bank transaction occurred.", "",
      `Application: ${result.application.reference}. Test order total: ${naira(result.order.totalNaira)}.`, "",
      "| Step completed | Repayments recorded | Scheduled balance remaining | Stage |",
      "|---|---:|---:|---|",
      ...checkpoints.map((p) => `| ${p.step} | ${naira(p.receivedNaira)} | ${naira(p.outstandingNaira)} | ${p.stage} |`), "",
      "The scheduled balance appears after order approval generates the installments; zero before that does not mean an unapproved order has been paid.", "",
      ...result.events.flatMap((event, index) => [`## ${index + 1}. ${event.title}`, "", `**${event.source}.** ${event.detail}`, ""]),
      `Final checks: all installments paid; remaining debt ${naira(result.policy.outstandingKobo / 100)}; test credit used ${naira(result.credit.usedNaira)}; ledger balanced: ${result.accounting.ledgerBalanced}.`, "",
      "Actual Recova acceptance testing still requires approved test identity/bank details, mandate authorisation, registered authenticated callbacks, and the confirmed collection/recovery sweep interface.", "",
    ].join("\n");
    await writeFile(reportPath, report);
    console.log(JSON.stringify({ reportPath, jsonPath, completed: result.complete,
      receivedNaira: result.accounting.receivedNaira, outstandingKobo: result.policy.outstandingKobo,
      ledgerBalanced: result.accounting.ledgerBalanced, providerTransactions: result.providerTransactions }));
  } finally { await runner.onModuleDestroy(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
