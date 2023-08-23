import { matchOccupancyStatus } from "./anonymization";
import * as anonymizedApc from "./quicktype/anonymizedApc";

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
