import type pino from "pino";
import type Pulsar from "pulsar-client";
import type {
  AnonymizationConfig,
  VehiclePassengerCountMap,
  VehicleProfileMap,
} from "./config";
import * as anonymizedApc from "./quicktype/anonymizedApc";
import * as matchedApc from "./quicktype/matchedApc";
import * as profileCollection from "./quicktype/profileCollection";
import createProfileMap from "./profile";
import { anonymize } from "./anonymization";

/**
 * Replace contents of a Map in-place.
 *
 * @param map The Map to be fully updated in-place.
 * @param newContents The Map whose contents will be copied into map.
 */
export const updateMap = <K, V>(
  map: Map<K, V>,
  newContents: Map<K, V>,
): void => {
  map.clear();
  newContents.forEach((value, key) => map.set(key, value));
};

const updateProfiles = async (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  profileReader: Pulsar.Reader,
) => {
  const profileCollectionPulsarMessage = await profileReader.readNext();
  const profileCollectionDataString = profileCollectionPulsarMessage
    .getData()
    .toString("utf8");
  let collection;
  try {
    collection = profileCollection.Convert.toProfileCollection(
      profileCollectionDataString,
    );
  } catch (err) {
    logger.error(
      {
        err,
        profileCollectionPulsarMessage: JSON.stringify(
          profileCollectionPulsarMessage,
        ),
        profileCollectionDataString,
      },
      "Could not parse profileCollectionPulsarMessage",
    );
  }
  if (collection != null) {
    let newVehicleProfileMap;
    try {
      newVehicleProfileMap = createProfileMap(collection);
    } catch (err) {
      logger.error({ err, collection }, "Could not create vehicle profile map");
    }
    if (newVehicleProfileMap != null) {
      updateMap(vehicleProfileMap, newVehicleProfileMap);
    }
  }
};

// FIXME: not needed yet
// const formInitialProfile = async (
//   logger: pino.Logger,
//   profileReader: Pulsar.Reader
// ): Promise<VehicleProfileMap> => {
//   const vehicleProfileMap: VehicleProfileMap = new Map();
//   // Errors are handled in the calling function.
//   /* eslint-disable no-await-in-loop */
//   while (vehicleProfileMap.size < 1) {
//     await updateProfiles(logger, vehicleProfileMap, profileReader);
//   }
//   /* eslint-enable no-await-in-loop */
//   return vehicleProfileMap;
// };

const keepUpdatingProfiles = async (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  profileReader: Pulsar.Reader,
) => {
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    await updateProfiles(logger, vehicleProfileMap, profileReader);
  }
  /* eslint-enable no-await-in-loop */
};

const handleApcMessage = (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  countCache: VehiclePassengerCountMap,
  apcPulsarMessage: Pulsar.Message,
  config: AnonymizationConfig,
): Pulsar.ProducerMessage | undefined => {
  let anonymizedPulsarMessage;
  const apcDataString = apcPulsarMessage.getData().toString("utf8");
  let apcMessage;
  try {
    apcMessage = matchedApc.Convert.toMatchedApc(apcDataString);
  } catch (err) {
    logger.error(
      {
        err,
        apcPulsarMessage: JSON.stringify(apcPulsarMessage),
        apcDataString,
      },
      "Could not parse apcPulsarMessage",
    );
  }
  if (apcMessage != null) {
    const anonymizedApcData = anonymize(
      logger,
      vehicleProfileMap,
      countCache,
      apcMessage,
      config,
    );
    if (anonymizedApcData != null) {
      const encoded = Buffer.from(
        anonymizedApc.Convert.anonymizedApcToJson(anonymizedApcData),
        "utf8",
      );
      anonymizedPulsarMessage = {
        data: encoded,
        properties: { topicSuffix: apcMessage.authorityId },
        eventTimestamp: apcPulsarMessage.getEventTimestamp(),
      };
    }
  }
  return anonymizedPulsarMessage;
};

const keepSendingAnonymizedApc = async (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  apcConsumer: Pulsar.Consumer,
  producer: Pulsar.Producer,
  config: AnonymizationConfig,
) => {
  const countCache: VehiclePassengerCountMap = new Map();
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const apcPulsarMessage = await apcConsumer.receive();
    const anonymizedPulsarMessage = handleApcMessage(
      logger,
      vehicleProfileMap,
      countCache,
      apcPulsarMessage,
      config,
    );
    if (anonymizedPulsarMessage != null) {
      // In case of an error, exit via the listener on unhandledRejection.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      producer.send(anonymizedPulsarMessage).then(() => {
        // In case of an error, exit via the listener on unhandledRejection.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        apcConsumer.acknowledge(apcPulsarMessage).then(() => {});
      });
    } else {
      await apcConsumer.acknowledge(apcPulsarMessage);
    }
  }
  /* eslint-enable no-await-in-loop */
};

export const keepProcessingMessages = async (
  logger: pino.Logger,
  producer: Pulsar.Producer,
  profileReader: Pulsar.Reader,
  apcConsumer: Pulsar.Consumer,
  config: AnonymizationConfig,
): Promise<void> => {
  // FIXME: add later
  // const vehicleProfileMap = await formInitialProfile(logger, profileReader);
  const { vehicleProfileMap } = config;
  const promises = [
    keepUpdatingProfiles(logger, vehicleProfileMap, profileReader),
    keepSendingAnonymizedApc(
      logger,
      vehicleProfileMap,
      apcConsumer,
      producer,
      config,
    ),
  ];
  // We expect both promises to stay pending.
  await Promise.any(promises);
};
