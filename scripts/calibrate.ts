// scripts/calibrate.ts
import { calibrate } from "../src/calibration/calibrate.js";
import { calibrationCorpus } from "../tests/fixtures/calibration-corpus.js";
import { loadBoundariesFromDisk } from "../src/boundary/node-loader.js";

const report = calibrate(calibrationCorpus(), loadBoundariesFromDisk());

console.log("JP Precinct Finder — calibration report");
console.log("=".repeat(48));
console.log(`total cases       : ${report.total}`);
console.log(`in-scope cases    : ${report.inScope}`);
console.log(`true-high         : ${report.trueHigh}`);
console.log(`safe abstentions  : ${report.safeAbstentions}`);
console.log(`coverage          : ${report.coveragePct}% of in-scope`);
console.log(`FALSE-HIGH        : ${report.falseHigh.length}`);
for (const fh of report.falseHigh) {
  console.log(
    `  ! ${fh.label}: expected ${fh.expectedCounty}/${fh.expectedPrecinct}, ` +
      `got ${fh.gotCounty}/${fh.gotPrecinct}`,
  );
}

if (report.falseHigh.length > 0) process.exit(1);
