import {
  parseProfileMessageToCollection,
  updateMap,
} from "./messageProcessing";

describe("updateMap", () => {
  test("Update empty Map", () => {
    const x = new Map();
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
  test("Update non-empty Map", () => {
    const x = new Map([["c", 3]]);
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
  test("Update non-empty Map with key overlap", () => {
    const x = new Map([["a", 3]]);
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
});

describe("parseProfileMessageToCollection", () => {
  test("Parses profiler-format message (vehicleModels/modelProfiles)", () => {
    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as import("pino").Logger;

    const csvExample = ["passenger_count,EMPTY,FULL", "0,1,0", "1,0,1"].join(
      "\n",
    );

    const profilerMessage = {
      schemaVersion: "1-0-0",
      vehicleModels: {
        "fi:jyvaskyla:test-vehicle": "40-35",
      },
      modelProfiles: {
        "40-35": csvExample,
      },
    };

    const parsed = parseProfileMessageToCollection(
      logger,
      JSON.stringify(profilerMessage),
    );

    expect(parsed).toBeDefined();
    expect(parsed?.schemaVersion).toBe("1-0-0");
    expect(parsed?.profiles["fi:jyvaskyla:test-vehicle"]).toBe(csvExample);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
