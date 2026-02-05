import type pino from "pino";
import {
  AnonymizationConfig,
  PassengerCount,
  UniqueVehicleId,
  UniqueVehicleJourneyId,
  VehiclePassengerCountMap,
  VehicleProfile,
} from "./types";
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
  // FIXME: somewhere here, change the code so that the counter is zeroed after 30 minutes of the vehicle being on deadrun
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
  lookup: (uniqueVehicleId: UniqueVehicleId) => VehicleProfile | undefined,
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
    const profile = lookup(uniqueVehicleId);
    if (profile == null) {
      logger.debug(
        { uniqueVehicleId },
        "We do not have a vehicle profile for this vehicle. We will probably have one later. Meanwhile the data from this vehicle is skipped.",
      );
    } else {
      const acceptedDeviceIds = acceptedDeviceMap.get(uniqueVehicleId);
      const messageDeviceId = matchedApcMessage.countingDeviceId;
      // Normalize to lowercase for case-insensitive matching
      const isDeviceAccepted =
        acceptedDeviceIds == null || acceptedDeviceIds.has(messageDeviceId.toLowerCase());

      if (!isDeviceAccepted) {
        logger.debug(
          {
            uniqueVehicleId,
            matchedApcMessage: redactCounts(matchedApcMessage),
            countingDeviceId: messageDeviceId,
            acceptedDeviceIds: Array.from(acceptedDeviceIds ?? []),
          },
          "Counting device not in accepted list for this vehicle. Skip the message.",
        );
      } else {
        if (
          matchedApcMessage.countQuality !== matchedApc.CountQuality.Regular
        ) {
          logger.warn(
            {
              uniqueVehicleId,
              matchedApcMessage: redactCounts(matchedApcMessage),
            },
            "The count quality is not regular. We will use it anyway.",
          );
        }
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
