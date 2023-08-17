import pino from "pino";
import { clamp, generateUniformRandom, sample } from "./sampling";

test("Uniform random numbers between 0 and 1", () => {
  Array.from({ length: 1e3 }, () => generateUniformRandom()).forEach((x) => {
    expect(x).toBeGreaterThanOrEqual(0.0);
    expect(x).toBeLessThan(1.0);
  });
});

describe("clamp", () => {
  test("clamp forces lower boundary", () => {
    expect(clamp(-1, 0, 2)).toStrictEqual(0);
  });
  test("clamp forces upper boundary", () => {
    expect(clamp(3, 0, 2)).toStrictEqual(2);
  });
  test("clamp does not change values in range", () => {
    expect(clamp(1, 0, 2)).toStrictEqual(1);
  });
  test("clamp does not do anything to NaN", () => {
    expect(clamp(NaN, 0, 2)).toStrictEqual(NaN);
  });
});

describe("sample", () => {
  test("Simple test", () => {
    const logger = pino(
      {
        name: "waltti-apc-anonymizer-tests",
        timestamp: pino.stdTimeFunctions.isoTime,
        level: "debug",
      },
      pino.destination({ sync: true }),
    );
    const profile = {
      categories: ["foo", "bar", "baz"],
      cdf: [
        new Float64Array([1.0, 1.0, 1.0]),
        new Float64Array([0.0, 1.0, 1.0]),
        new Float64Array([0.0, 0.0, 1.0]),
      ],
    };
    const cases: [number, string][] = [
      [-1, "foo"],
      [0, "foo"],
      [1, "bar"],
      [2, "baz"],
      [3, "baz"],
    ];
    const nTestIterations = 1e2;
    cases.forEach(([passengerCount, expectedCategory]) => {
      Array.from({ length: nTestIterations }, () =>
        sample(logger, profile, passengerCount),
      ).forEach((category) => {
        expect(category).toStrictEqual(expectedCategory);
      });
    });
  });

  test("Some choice", () => {
    const logger = pino(
      {
        name: "waltti-apc-anonymizer-tests",
        timestamp: pino.stdTimeFunctions.isoTime,
        level: "debug",
      },
      pino.destination({ sync: true }),
    );
    const profile = {
      categories: ["foo", "bar", "baz"],
      cdf: [
        new Float64Array([0.5, 1.0, 1.0]),
        new Float64Array([0.0, 0.5, 1.0]),
      ],
    };
    const cases: [number, string[]][] = [
      [-1, ["foo", "bar"]],
      [0, ["foo", "bar"]],
      [1, ["bar", "baz"]],
      [2, ["bar", "baz"]],
    ];
    const nTestIterations = 1e2;
    cases.forEach(([passengerCount, expectedCategories]) => {
      Array.from({ length: nTestIterations }, () =>
        sample(logger, profile, passengerCount),
      ).forEach((category) => {
        expect(expectedCategories).toContain(category);
      });
    });
  });
});
