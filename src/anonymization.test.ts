import {
  getCountAndUpdateCache,
  isSameUniqueVehicleJourneyId,
  matchOccupancyStatus,
  passengerCountStalenessLimitInMilliseconds,
} from "./anonymization";
import * as anonymizedApc from "./quicktype/anonymizedApc";
import * as matchedApc from "./quicktype/matchedApc";
import type {
  UniqueVehicleId,
  UniqueVehicleJourneyId,
  VehiclePassengerCountMap,
} from "./types";

describe("matchOccupancyStatus", () => {
  test("empty string", () => {
    expect(matchOccupancyStatus("")).toStrictEqual(undefined);
  });

  test("foo", () => {
    expect(matchOccupancyStatus("foo")).toStrictEqual(undefined);
  });

  test("EMPTY", () => {
    expect(matchOccupancyStatus("EMPTY")).toStrictEqual(
      anonymizedApc.OccupancyStatus.Empty,
    );
  });

  test("MANY_SEATS_AVAILABLE", () => {
    expect(matchOccupancyStatus("MANY_SEATS_AVAILABLE")).toStrictEqual(
      anonymizedApc.OccupancyStatus.ManySeatsAvailable,
    );
  });

  test("FEW_SEATS_AVAILABLE", () => {
    expect(matchOccupancyStatus("FEW_SEATS_AVAILABLE")).toStrictEqual(
      anonymizedApc.OccupancyStatus.FewSeatsAvailable,
    );
  });

  test("STANDING_ROOM_ONLY", () => {
    expect(matchOccupancyStatus("STANDING_ROOM_ONLY")).toStrictEqual(
      anonymizedApc.OccupancyStatus.StandingRoomOnly,
    );
  });

  test("CRUSHED_STANDING_ROOM_ONLY", () => {
    expect(matchOccupancyStatus("CRUSHED_STANDING_ROOM_ONLY")).toStrictEqual(
      anonymizedApc.OccupancyStatus.CrushedStandingRoomOnly,
    );
  });

  test("FULL", () => {
    expect(matchOccupancyStatus("FULL")).toStrictEqual(
      anonymizedApc.OccupancyStatus.Full,
    );
  });
});

// Build a fresh object each time, like getUniqueVehicleJourneyId does for
// every incoming message. The count cache must accumulate across messages
// even though each message carries a distinct journey ID object.
const createJourneyId = (
  overrides: Partial<UniqueVehicleJourneyId> = {},
): UniqueVehicleJourneyId => ({
  gtfsrtDirectionId: 0,
  gtfsrtRouteId: "4",
  gtfsrtStartDate: "20260729",
  gtfsrtStartTime: "07:30:00",
  gtfsrtTripId: "Talvikausi_Ke_4_0730",
  ...overrides,
});

const createDoorClassCounts = (
  inCount: number,
  outCount: number,
): matchedApc.DoorClassCount[] => [
  {
    countClass: matchedApc.CountClass.Adult,
    doorName: "1",
    in: inCount,
    out: outCount,
  },
];

describe("isSameUniqueVehicleJourneyId", () => {
  test("equal contents in distinct objects match", () => {
    expect(
      isSameUniqueVehicleJourneyId(createJourneyId(), createJourneyId()),
    ).toStrictEqual(true);
  });

  test("any differing field prevents a match", () => {
    const base = createJourneyId();
    expect(
      isSameUniqueVehicleJourneyId(
        base,
        createJourneyId({ gtfsrtDirectionId: 1 }),
      ),
    ).toStrictEqual(false);
    expect(
      isSameUniqueVehicleJourneyId(
        base,
        createJourneyId({ gtfsrtRouteId: "5" }),
      ),
    ).toStrictEqual(false);
    expect(
      isSameUniqueVehicleJourneyId(
        base,
        createJourneyId({ gtfsrtStartDate: "20260730" }),
      ),
    ).toStrictEqual(false);
    expect(
      isSameUniqueVehicleJourneyId(
        base,
        createJourneyId({ gtfsrtStartTime: "08:30:00" }),
      ),
    ).toStrictEqual(false);
    expect(
      isSameUniqueVehicleJourneyId(
        base,
        createJourneyId({ gtfsrtTripId: "Talvikausi_Ke_4_0830" }),
      ),
    ).toStrictEqual(false);
  });
});

describe("getCountAndUpdateCache", () => {
  const uniqueVehicleId: UniqueVehicleId = "fi:jyvaskyla:6714_97";
  const baseTimestamp = 1_753_764_600_000;
  const minuteInMilliseconds = 60_000;

  test("first message on a journey returns its own sum", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(7, 0),
        baseTimestamp,
      ),
    ).toStrictEqual(7);
  });

  test("counts accumulate across messages on the same journey", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(7, 0),
      baseTimestamp,
    );
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(10, 2),
      baseTimestamp + 5 * minuteInMilliseconds,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(90, 8),
        baseTimestamp + 10 * minuteInMilliseconds,
      ),
    ).toStrictEqual(97);
  });

  test("a new journey resets the count", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(40, 0),
      baseTimestamp,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId({ gtfsrtTripId: "Talvikausi_Ke_4_0830" }),
        createDoorClassCounts(5, 0),
        baseTimestamp + 5 * minuteInMilliseconds,
      ),
    ).toStrictEqual(5);
  });

  test("vehicles do not share counts", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(40, 0),
      baseTimestamp,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        "fi:jyvaskyla:6714_98",
        createJourneyId(),
        createDoorClassCounts(3, 1),
        baseTimestamp,
      ),
    ).toStrictEqual(2);
  });

  test("count classes with multiplier two are counted twice", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      [
        {
          countClass: matchedApc.CountClass.Adult,
          doorName: "1",
          in: 3,
          out: 0,
        },
        {
          countClass: matchedApc.CountClass.Pram,
          doorName: "2",
          in: 1,
          out: 0,
        },
      ],
      baseTimestamp,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(0, 1),
        baseTimestamp + minuteInMilliseconds,
      ),
    ).toStrictEqual(4);
  });

  test("a gap of exactly the staleness limit still accumulates", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(40, 0),
      baseTimestamp,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(5, 0),
        baseTimestamp + passengerCountStalenessLimitInMilliseconds,
      ),
    ).toStrictEqual(45);
  });

  test("a gap longer than the staleness limit resets the count", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(40, 0),
      baseTimestamp,
    );
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(5, 0),
        baseTimestamp + passengerCountStalenessLimitInMilliseconds + 1,
      ),
    ).toStrictEqual(5);
  });

  test("an out-of-order message does not move the timestamp backwards", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(20, 0),
      baseTimestamp + 25 * minuteInMilliseconds,
    );
    // A delayed message with an older event timestamp arrives late.
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(10, 0),
      baseTimestamp,
    );
    // 27 minutes after the newest accumulated message. If the delayed message
    // had moved the cached timestamp backwards, this would falsely reset.
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(5, 0),
        baseTimestamp + 52 * minuteInMilliseconds,
      ),
    ).toStrictEqual(35);
  });

  test("the staleness gap is measured from the latest message, not the first", () => {
    const countCache: VehiclePassengerCountMap = new Map();
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(20, 0),
      baseTimestamp,
    );
    getCountAndUpdateCache(
      countCache,
      uniqueVehicleId,
      createJourneyId(),
      createDoorClassCounts(10, 0),
      baseTimestamp + 25 * minuteInMilliseconds,
    );
    // 50 minutes after the first message but only 25 minutes after the
    // latest one, so the count must keep accumulating.
    expect(
      getCountAndUpdateCache(
        countCache,
        uniqueVehicleId,
        createJourneyId(),
        createDoorClassCounts(5, 0),
        baseTimestamp + 50 * minuteInMilliseconds,
      ),
    ).toStrictEqual(35);
  });
});
