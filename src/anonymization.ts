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

export const buildAnonymizedApcMessage = (
  matchedApcMessage: matchedApc.MatchedApc,
  occupancyStatusString: string,
): anonymizedApc.AnonymizedApc | undefined => {
  let result;
  const occupancyStatus =
    anonymizedApc.OccupancyStatus[
      occupancyStatusString as keyof typeof anonymizedApc.OccupancyStatus
    ];
  if (occupancyStatus != null) {
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
      // FIXME: remove these chatty logs when new vehicles with counting devices
      //        are available
      if (acceptedCountingDeviceId == null) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: JSON.stringify(matchedApcMessage),
          },
          "The vehicle was not in acceptedDeviceMap",
        );
      } else if (
        acceptedCountingDeviceId === matchedApcMessage.countingDeviceId
      ) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: JSON.stringify(matchedApcMessage),
          },
          "The vehicle was in acceptedDeviceMap and the device is accepted",
        );
      } else {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: JSON.stringify(matchedApcMessage),
            acceptedCountingDeviceId,
          },
          "The vehicle was in acceptedDeviceMap but the device is not accepted",
        );
      }
      if (matchedApcMessage.countQuality !== matchedApc.CountQuality.Regular) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: JSON.stringify(matchedApcMessage),
          },
          "The count quality was not regular",
        );
      }
      /**
       * As there are only a few vehicles with more than one counting device,
       * the map contains only those vehicles. If a vehicle is not in the map,
       * the device is accepted for publishing.
       */
      if (
        (acceptedCountingDeviceId == null ||
          acceptedCountingDeviceId === matchedApcMessage.countingDeviceId) &&
        matchedApcMessage.countQuality === matchedApc.CountQuality.Regular
      ) {
        const currentSum = getCountAndUpdateCache(
          countCache,
          uniqueVehicleId,
          uniqueVehicleJourneyId,
          matchedApcMessage.doorClassCounts,
        );
        const occupancyStatusString = sample(logger, profile, currentSum);
        // FIXME: remove after debugging
        logger.debug(
          {
            occupancyStatusString,
            profile,
            currentSum,
            uniqueVehicleId,
            uniqueVehicleJourneyId,
          },
          "occupancyStatusString has been calculated",
        );
        if (occupancyStatusString != null) {
          result = buildAnonymizedApcMessage(
            matchedApcMessage,
            occupancyStatusString,
          );
          // FIXME: remove after debugging
          logger.debug(
            {
              anonymizedApcMessage: JSON.stringify(result),
              uniqueVehicleId,
              uniqueVehicleJourneyId,
            },
            "anonymizedApcMessage has been calculated",
          );
        }
      }
    }
  }
  return result;
};
