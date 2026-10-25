import { assessCertainty } from "../resolve/certainty.js";
import type {
  CalibrationCase,
  CalibrationReport,
  FalseHighRecord,
  PrecinctFeature,
} from "../types.js";

/**
 * Score labeled cases against the resolver. The one gated outcome is a
 * false-high: a `high` answer whose county/precinct does not match the expected
 * (or that asserts a precinct for an out-of-scope / near-boundary case whose
 * expectedPrecinct is null). Coverage = correct-high over in-scope cases.
 */
export function calibrate(
  cases: CalibrationCase[],
  features: PrecinctFeature[],
): CalibrationReport {
  const falseHigh: FalseHighRecord[] = [];
  let trueHigh = 0;
  let safeAbstentions = 0;

  for (const c of cases) {
    const r = assessCertainty(
      { lon: c.lon, lat: c.lat, method: c.method, precisionMeters: c.precisionMeters },
      features,
    );

    if (r.confidence === "high") {
      const correct = r.county === c.expectedCounty && r.precinct === c.expectedPrecinct;
      if (correct) {
        trueHigh++;
      } else {
        falseHigh.push({
          label: c.label,
          expectedCounty: c.expectedCounty,
          expectedPrecinct: c.expectedPrecinct,
          gotCounty: r.county,
          gotPrecinct: r.precinct,
        });
      }
    } else {
      // review / needs_verification: the system declined to assert — always safe.
      safeAbstentions++;
    }
  }

  const inScope = cases.filter((c) => c.expectedPrecinct !== null).length;
  const coveragePct = inScope === 0 ? 0 : Math.round((trueHigh / inScope) * 100);

  return { total: cases.length, inScope, trueHigh, falseHigh, safeAbstentions, coveragePct };
}
