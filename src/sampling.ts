import crypto from "node:crypto";
import type pino from "pino";
import type { VehicleProfile } from "./types";

/**
 * Create a cryptographically strong uniform random number in the range [0, 1[.
 */
export const generateUniformRandom = () => {
  // 2 ** 48 - 1 is the maximum allowed value for max when min is zero.
  const exclusiveUpperBound = 2 ** 48 - 1;
  // Upper bound is exclusive.
  const maxRandomValue = exclusiveUpperBound - 1;
  /**
   * Tested locally that when maxRandomValue is divided by the divisor
   * incorporating epsilon of at least 0.02, the quotient is less than 1.0,
   * as required. We rely on IEEE-754 to ensure that this holds on other
   * computers, as well.
   */
  const empiricallyFoundEpsilon = 0.02;
  const divisor = maxRandomValue + empiricallyFoundEpsilon;
  const randomValue = crypto.randomInt(exclusiveUpperBound);
  const normalizedRandomValue = randomValue / divisor;
  return normalizedRandomValue;
};

export const clamp = (x: number, smallest: number, largest: number) =>
  Math.max(smallest, Math.min(x, largest));

export const sample = (
  logger: pino.Logger,
  profile: VehicleProfile,
  passengerCount: number,
): string | undefined => {
  let result: string | undefined;
  const maxCount = profile.cdf.length - 1;
  const clampedCount = clamp(passengerCount, 0, maxCount);
  const cdfGivenCount = profile.cdf[clampedCount];
  if (cdfGivenCount == null) {
    logger.error(
      { profile, passengerCount, clampedCount },
      "Implementation error: clampedCount outside of CDF array length.",
    );
  } else {
    const p = generateUniformRandom();
    const index = cdfGivenCount.findIndex((elem: number) => p <= elem);
    if (index < 0) {
      logger.error(
        { cdfGivenCount, p, profile },
        "Implementation error: Could not find index for probability within cdfGivenCount.",
      );
    } else {
      result = profile.categories[index];
      if (result == null) {
        logger.error(
          { cdfGivenCount, p, index, categories: profile.categories, profile },
          "Implementation error: Index outside of category array.",
        );
      }
    }
  }
  return result;
};
