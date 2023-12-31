import type pino from "pino";
import {
  AnonymizationConfig,
  PassengerCount,
  UniqueVehicleId,
  UniqueVehicleJourneyId,
  VehiclePassengerCountMap,
  VehicleProfileMap,
} from "./config";
import * as anonymizedApc from "./quicktype/anonymizedApc";
import * as matchedApc from "./quicktype/matchedApc";
import { sample } from "./sampling";

export const getCountMultiplier = (
  countClass: matchedApc.CountClass,
): number => {
  switch (countClass) {
    case matchedApc.CountClass.Adult:
      return 1;
    case matchedApc.CountClass.Child:
      return 1;
    case matchedApc.CountClass.Pram:
      return 2;
    case matchedApc.CountClass.Bike:
      return 2;
    case matchedApc.CountClass.Wheelchair:
      return 2;
    case matchedApc.CountClass.Other:
      return 1;
    default: {
      const exhaustiveCheck: never = countClass;
      throw new Error(String(exhaustiveCheck));
    }
  }
};

export const sumDoorsAndClasses = (
  doorClassCounts: matchedApc.DoorClassCount[],
): number =>
  doorClassCounts.reduce(
    (accumulator, doorClassCount) =>
      accumulator +
      getCountMultiplier(doorClassCount.countClass) *
        (doorClassCount.in - doorClassCount.out),
    0.0,
  );

export const getCountAndUpdateCache = (
  countCache: VehiclePassengerCountMap,
  uniqueVehicleId: UniqueVehicleId,
  uniqueVehicleJourneyId: UniqueVehicleJourneyId,
  doorClassCounts: matchedApc.DoorClassCount[],
): number => {
  const messageSum = sumDoorsAndClasses(doorClassCounts);
  const cachedCount = countCache.get(uniqueVehicleId);
  let currentCount: [UniqueVehicleJourneyId, PassengerCount] = [
    uniqueVehicleJourneyId,
    messageSum,
  ];
  if (cachedCount != null && cachedCount[0] === uniqueVehicleJourneyId) {
    currentCount = [uniqueVehicleJourneyId, cachedCount[1] + messageSum];
  }
  countCache.set(uniqueVehicleId, currentCount);
  return currentCount[1];
};

export const matchOccupancyStatus = (
  occupancyStatusString: string,
): anonymizedApc.OccupancyStatus | undefined =>
  Object.entries(anonymizedApc.OccupancyStatus).find(
    // According to the tests, this ESLint warning is irrelevant.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    ([, value]) => value === occupancyStatusString,
  )?.[1];

export const redactCounts = (
  matchedApcMessage: matchedApc.MatchedApc,
): Omit<matchedApc.MatchedApc, "doorClassCounts"> => {
  const reducedObject:
    | Omit<matchedApc.MatchedApc, "doorClassCounts">
    | matchedApc.MatchedApc = { ...matchedApcMessage };
  delete reducedObject.doorClassCounts;
  return reducedObject;
};

export const buildAnonymizedApcMessage = (
  logger: pino.Logger,
  matchedApcMessage: matchedApc.MatchedApc,
  occupancyStatusString: string,
): anonymizedApc.AnonymizedApc | undefined => {
  let result: anonymizedApc.AnonymizedApc | undefined;
  const occupancyStatus = matchOccupancyStatus(occupancyStatusString);
  if (occupancyStatus == null) {
    logger.error(
      {
        matchedApcMessageWithoutCounts: JSON.stringify(
          redactCounts(matchedApcMessage),
        ),
        occupancyStatusString,
      },
      "occupancyStatusString did not match enum OccupancyStatus. Likely the vehicle profile has an unexpected CSV header.",
    );
  } else {
    result = {
      schemaVersion: "1-0-0",
      timestamp: new Date().toISOString(),
      authorityId: matchedApcMessage.authorityId,
      currentStopSequence: matchedApcMessage.gtfsrtCurrentStopSequence,
      directionId: matchedApcMessage.gtfsrtDirectionId,
      routeId: matchedApcMessage.gtfsrtRouteId,
      startDate: matchedApcMessage.gtfsrtStartDate,
      startTime: matchedApcMessage.gtfsrtStartTime,
      stopId: matchedApcMessage.gtfsrtStopId,
      tripId: matchedApcMessage.gtfsrtTripId,
      vehicleId: matchedApcMessage.gtfsrtVehicleId,
      occupancyStatus,
    };
  }
  return result;
};

const getUniqueVehicleJourneyId = (
  matchedApcMessage: matchedApc.MatchedApc,
): UniqueVehicleJourneyId => {
  const {
    gtfsrtDirectionId,
    gtfsrtRouteId,
    gtfsrtStartDate,
    gtfsrtStartTime,
    gtfsrtTripId,
  } = matchedApcMessage;
  return {
    gtfsrtDirectionId,
    gtfsrtRouteId,
    gtfsrtStartDate,
    gtfsrtStartTime,
    gtfsrtTripId,
  };
};

export const anonymize = (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  countCache: VehiclePassengerCountMap,
  matchedApcMessage: matchedApc.MatchedApc,
  { feedPublisherWalttiAuthorityMap, acceptedDeviceMap }: AnonymizationConfig,
): anonymizedApc.AnonymizedApc | undefined => {
  let result: anonymizedApc.AnonymizedApc | undefined;
  const vehicleId = matchedApcMessage.gtfsrtVehicleId;
  const walttiAuthorityId = matchedApcMessage.authorityId;
  const feedPublisherId =
    feedPublisherWalttiAuthorityMap.get(walttiAuthorityId);
  if (feedPublisherId == null) {
    logger.error(
      { vehicleId, walttiAuthorityId, feedPublisherWalttiAuthorityMap },
      "walttiAuthorityId must match a feedPublisherId. Skipping APC message.",
    );
  } else {
    const uniqueVehicleId: UniqueVehicleId = `${feedPublisherId}:${vehicleId}`;
    const uniqueVehicleJourneyId = getUniqueVehicleJourneyId(matchedApcMessage);
    const profile = vehicleProfileMap.get(uniqueVehicleId);
    if (profile == null) {
      logger.debug(
        { uniqueVehicleId },
        "The vehicle is not in the vehicleProfileMap. It will probably end there later. Meanwhile the data from this vehicle is skipped.",
      );
    } else {
      const acceptedCountingDeviceId = acceptedDeviceMap.get(uniqueVehicleId);
      if (
        acceptedCountingDeviceId != null &&
        acceptedCountingDeviceId !== matchedApcMessage.countingDeviceId
      ) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: redactCounts(matchedApcMessage),
            acceptedCountingDeviceId,
          },
          "The vehicle is in acceptedDeviceMap but the counting device is not the one accepted for publishing.",
        );
      }
      if (matchedApcMessage.countQuality !== matchedApc.CountQuality.Regular) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: redactCounts(matchedApcMessage),
          },
          "The count quality is not regular. We will use it anyway.",
        );
      }
      /**
       * As there are only a few vehicles with more than one counting device,
       * the map contains only those vehicles. If a vehicle is not in the map,
       * the device is accepted for publishing.
       */
      if (
        acceptedCountingDeviceId == null ||
        acceptedCountingDeviceId === matchedApcMessage.countingDeviceId
      ) {
        const currentSum = getCountAndUpdateCache(
          countCache,
          uniqueVehicleId,
          uniqueVehicleJourneyId,
          matchedApcMessage.doorClassCounts,
        );
        const occupancyStatusString = sample(logger, profile, currentSum);
        if (occupancyStatusString != null) {
          result = buildAnonymizedApcMessage(
            logger,
            matchedApcMessage,
            occupancyStatusString,
          );
        }
      }
    }
  }
  return result;
};
