import type pino from "pino";
import type Pulsar from "pulsar-client";
import type { AcceptedDeviceMap, UniqueVehicleId } from "./types";
import * as VehicleApcMapping from "./quicktype/vehicleApcMapping";

/**
 * Get the unique vehicle ID from a VehicleApcMapping.
 * Format: feedPublisherId:operatorId_vehicleShortName
 */
const getUniqueVehicleIdFromVehicleApcMapping = (
  vehicle: VehicleApcMapping.VehicleApcMapping,
  feedPublisherId: string,
): UniqueVehicleId | undefined => {
  const { operatorId, vehicleShortName } = vehicle;
  if (operatorId != null && vehicleShortName != null) {
    return `${feedPublisherId}:${operatorId}_${vehicleShortName}` as UniqueVehicleId;
  }
  return undefined;
};

/**
 * Update the acceptedDeviceMap from a vehicle catalogue message.
 * This replaces the static ACCEPTED_DEVICE_MAP with dynamic data from Pulsar.
 *
 * @param logger The pino logger
 * @param message The Pulsar message containing vehicle catalogue data
 * @param feedPublisherId The feed publisher ID to use for constructing unique vehicle IDs
 * @param acceptedDeviceMap The map to update (mutated in place)
 */
export const updateAcceptedDeviceMap = (
  logger: pino.Logger,
  message: Pulsar.Message,
  feedPublisherId: string,
  acceptedDeviceMap: AcceptedDeviceMap,
): void => {
  const dataString = message.getData().toString("utf8");

  let vehicles: VehicleApcMapping.VehicleApcMapping[];
  try {
    vehicles = VehicleApcMapping.Convert.toVehicleApcMapping(dataString);
  } catch (err) {
    logger.warn(
      {
        err,
        messageId: message.getMessageId().toString(),
        eventTimestamp: message.getEventTimestamp(),
      },
      "Could not parse vehicle registry message",
    );
    return;
  }

  // Clear the current map for this feed publisher and rebuild
  const keysToRemove = Array.from(acceptedDeviceMap.keys()).filter((key) =>
    key.startsWith(`${feedPublisherId}:`),
  );
  keysToRemove.forEach((key) => acceptedDeviceMap.delete(key));

  let addedCount = 0;
  vehicles.forEach((vehicle) => {
    const uniqueVehicleId = getUniqueVehicleIdFromVehicleApcMapping(
      vehicle,
      feedPublisherId,
    );

    if (uniqueVehicleId == null) {
      logger.warn(
        {
          vehicle: {
            operatorId: vehicle.operatorId,
            vehicleShortName: vehicle.vehicleShortName,
          },
        },
        "Could not construct uniqueVehicleId from vehicle",
      );
      return;
    }

    const passengerCounters = vehicle.equipment.filter(
      (eq) => eq.type === "PASSENGER_COUNTER",
    );

    if (passengerCounters.length > 0) {
      const deviceIds = new Set<string>();
      passengerCounters.forEach((counter) => {
        if (counter.id != null) {
          // Normalize to lowercase for case-insensitive matching
          deviceIds.add(counter.id.toLowerCase());
        }
      });

      if (deviceIds.size > 0) {
        acceptedDeviceMap.set(uniqueVehicleId, deviceIds);
        addedCount += 1;
        logger.debug(
          { uniqueVehicleId, deviceIds: Array.from(deviceIds) },
          "Added vehicle to acceptedDeviceMap",
        );
      }
    }
  });

  logger.info(
    {
      feedPublisherId,
      totalVehicles: vehicles.length,
      vehiclesWithCounters: addedCount,
      mapSize: acceptedDeviceMap.size,
    },
    "Updated acceptedDeviceMap from vehicle catalogue",
  );
};

/**
 * Create a vehicle registry handler that updates the accepted device map.
 */
export const createVehicleRegistryHandler = (
  logger: pino.Logger,
  acceptedDeviceMap: AcceptedDeviceMap,
  feedPublisherWalttiAuthorityMap: Map<string, string>,
): {
  update: (message: Pulsar.Message) => void;
} => {
  const update = (message: Pulsar.Message): void => {
    // Extract authority/feedPublisher from topic name
    // Topic format: persistent://apc-sandbox/source/vehicle-catalogue-fi-jyvaskyla
    const topic = message.getTopicName();
    const topicParts = topic.split("/");
    const topicName = topicParts[topicParts.length - 1];

    if (topicName == null) {
      logger.warn({ topic }, "Could not extract topic name from topic");
      return;
    }

    // Try to extract feedPublisherId from topic name
    // Expected format: vehicle-catalogue-{feedPublisherId} e.g. vehicle-catalogue-fi-jyvaskyla
    let feedPublisherId: string | undefined;

    // First try to find by checking if the topic contains the feedPublisherId
    Array.from(feedPublisherWalttiAuthorityMap.entries()).forEach(
      ([, fpId]) => {
        // Check if topic contains the feedPublisherId (with colons replaced by dashes)
        if (topicName.includes(fpId.replace(/:/g, "-"))) {
          feedPublisherId = fpId;
        }
      },
    );

    // If not found, try to extract from topic name directly
    if (feedPublisherId == null) {
      // Extract the suffix after "vehicle-catalogue-"
      const match = topicName.match(/vehicle-catalogue-(.+)/);
      if (match != null && match[1] != null) {
        // Convert fi-jyvaskyla to fi:jyvaskyla
        feedPublisherId = match[1].replace(/-/g, ":");
      }
    }

    if (feedPublisherId == null) {
      logger.warn(
        { topic, topicName },
        "Could not determine feedPublisherId from vehicle catalogue topic",
      );
      return;
    }

    updateAcceptedDeviceMap(
      logger,
      message,
      feedPublisherId,
      acceptedDeviceMap,
    );
  };

  return { update };
};
