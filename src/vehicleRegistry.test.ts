import pino from "pino";
import type Pulsar from "pulsar-client";
import {
  updateAcceptedDeviceMap,
  createVehicleRegistryHandler,
} from "./vehicleRegistry";
import type { AcceptedDeviceMap, UniqueVehicleId } from "./types";

// Create a silent logger for tests
const logger = pino({ level: "silent" });

// Helper to create a mock Pulsar message
const createMockMessage = (
  data: string,
  topicName: string = "persistent://apc-sandbox/source/vehicle-catalogue-fi-jyvaskyla",
): Pulsar.Message =>
  ({
    getData: () => Buffer.from(data, "utf8"),
    getTopicName: () => topicName,
    getMessageId: () => ({
      toString: () => "mock-message-id",
    }),
    getEventTimestamp: () => Date.now(),
    getProperties: () => ({}),
  }) as unknown as Pulsar.Message;

describe("updateAcceptedDeviceMap", () => {
  test("adds single-device vehicle to map", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "518",
        equipment: [{ id: "JL518-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_518" as UniqueVehicleId),
    ).toEqual(new Set(["jl518-apc"]));
  });

  test("adds all devices for multi-device vehicle", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "520",
        equipment: [
          { id: "JL520-APC-1", type: "PASSENGER_COUNTER" },
          { id: "JL520-APC-2", type: "PASSENGER_COUNTER" },
        ],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_520" as UniqueVehicleId),
    ).toEqual(new Set(["jl520-apc-1", "jl520-apc-2"]));
  });

  test("ignores non-PASSENGER_COUNTER equipment", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "521",
        equipment: [
          { id: "JL521-APC", type: "PASSENGER_COUNTER" },
          { id: "JL521-GPS", type: "GPS" },
        ],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_521" as UniqueVehicleId),
    ).toEqual(new Set(["jl521-apc"]));
  });

  test("skips vehicle with no PASSENGER_COUNTER equipment", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "522",
        equipment: [{ id: "JL522-GPS", type: "GPS" }],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(0);
  });

  test("clears previous entries for same feedPublisherId", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    acceptedDeviceMap.set(
      "fi:jyvaskyla:6714_old" as UniqueVehicleId,
      new Set(["OLD-DEVICE"]),
    );
    acceptedDeviceMap.set(
      "fi:kuopio:44517_other" as UniqueVehicleId,
      new Set(["OTHER-DEVICE"]),
    );

    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "518",
        equipment: [{ id: "JL518-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    // Old fi:jyvaskyla entry should be removed, fi:kuopio preserved
    expect(acceptedDeviceMap.size).toBe(2);
    expect(
      acceptedDeviceMap.has("fi:jyvaskyla:6714_old" as UniqueVehicleId),
    ).toBe(false);
    expect(
      acceptedDeviceMap.has("fi:kuopio:44517_other" as UniqueVehicleId),
    ).toBe(true);
    expect(
      acceptedDeviceMap.has("fi:jyvaskyla:6714_518" as UniqueVehicleId),
    ).toBe(true);
  });

  test("later message with new format overrides earlier message with old format", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();

    const oldFormatMessage = createMockMessage(
      JSON.stringify([
        {
          operatorId: "6714",
          vehicleShortName: "483",
          equipment: [
            { id: "6714_483", type: "PASSENGER_COUNTER", apcSystem: "TELIA" },
          ],
        },
      ]),
    );
    updateAcceptedDeviceMap(
      logger,
      oldFormatMessage,
      "fi:jyvaskyla",
      acceptedDeviceMap,
    );

    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_483" as UniqueVehicleId),
    ).toEqual(new Set(["6714_483"]));

    const newFormatMessage = createMockMessage(
      JSON.stringify([
        {
          operatorId: "6714",
          vehicleShortName: "483",
          equipment: [
            {
              id: "JL483-0009d8066d7c",
              type: "PASSENGER_COUNTER",
              apcSystem: "TELIA",
            },
          ],
        },
      ]),
    );
    updateAcceptedDeviceMap(
      logger,
      newFormatMessage,
      "fi:jyvaskyla",
      acceptedDeviceMap,
    );

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_483" as UniqueVehicleId),
    ).toEqual(new Set(["jl483-0009d8066d7c"]));
  });

  test("handles multiple vehicles in one message", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "518",
        equipment: [{ id: "JL518-APC", type: "PASSENGER_COUNTER" }],
      },
      {
        operatorId: "6714",
        vehicleShortName: "519",
        equipment: [{ id: "JL519-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(2);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_518" as UniqueVehicleId),
    ).toEqual(new Set(["jl518-apc"]));
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_519" as UniqueVehicleId),
    ).toEqual(new Set(["jl519-apc"]));
  });

  test("handles invalid JSON gracefully", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const message = createMockMessage("not valid json");

    // Should not throw
    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(0);
  });

  test("adds vehicle with counting system id format and apcSystem", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "476",
        equipment: [
          {
            id: "JL476-0009d80670fc",
            type: "PASSENGER_COUNTER",
            apcSystem: "TELIA",
          },
        ],
      },
    ]);
    const message = createMockMessage(vehicleData);

    updateAcceptedDeviceMap(logger, message, "fi:jyvaskyla", acceptedDeviceMap);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.get("fi:jyvaskyla:6714_476" as UniqueVehicleId),
    ).toEqual(new Set(["jl476-0009d80670fc"]));
  });
});

describe("createVehicleRegistryHandler", () => {
  test("extracts feedPublisherId from topic name", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const authorityMap = new Map([
      ["221", "fi:kuopio"],
      ["209", "fi:jyvaskyla"],
    ]);

    const { update } = createVehicleRegistryHandler(
      logger,
      acceptedDeviceMap,
      authorityMap,
    );

    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "518",
        equipment: [{ id: "JL518-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(
      vehicleData,
      "persistent://apc-sandbox/source/vehicle-catalogue-fi-jyvaskyla",
    );

    update(message);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(
      acceptedDeviceMap.has("fi:jyvaskyla:6714_518" as UniqueVehicleId),
    ).toBe(true);
  });

  test("handles topic with different feedPublisherId format", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();
    const authorityMap = new Map([["221", "fi:kuopio"]]);

    const { update } = createVehicleRegistryHandler(
      logger,
      acceptedDeviceMap,
      authorityMap,
    );

    const vehicleData = JSON.stringify([
      {
        operatorId: "44517",
        vehicleShortName: "6",
        equipment: [{ id: "KL006-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(
      vehicleData,
      "persistent://apc-sandbox/source/vehicle-catalogue-fi-kuopio",
    );

    update(message);

    expect(acceptedDeviceMap.size).toBe(1);
    expect(acceptedDeviceMap.has("fi:kuopio:44517_6" as UniqueVehicleId)).toBe(
      true,
    );
  });

  test("does not update map when topic has no vehicle-catalogue prefix", () => {
    const acceptedDeviceMap: AcceptedDeviceMap = new Map();

    const { update } = createVehicleRegistryHandler(
      logger,
      acceptedDeviceMap,
      new Map([
        ["209", "fi:jyvaskyla"],
        ["221", "fi:kuopio"],
      ]),
    );

    const vehicleData = JSON.stringify([
      {
        operatorId: "6714",
        vehicleShortName: "518",
        equipment: [{ id: "JL518-APC", type: "PASSENGER_COUNTER" }],
      },
    ]);
    const message = createMockMessage(
      vehicleData,
      "persistent://apc-sandbox/source/some-other-topic",
    );

    update(message);

    expect(acceptedDeviceMap.size).toBe(0);
  });
});
