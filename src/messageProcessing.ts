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

export const parseProfileMessageToCollection = (
  logger: pino.Logger,
  profileCollectionDataString: string,
): profileCollection.ProfileCollection | undefined => {
  try {
    return profileCollection.Convert.toProfileCollection(
      profileCollectionDataString,
    );
  } catch (err) {
    // Profiler-format compatibility:
    // The vehicle anonymization profiler publishes a message with
    // { vehicleModels, modelProfiles } where each vehicle maps to a model key,
    // and the model key maps to the CSV profile string. Convert that into the
    // ProfileCollection shape expected by the anonymizer.
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(profileCollectionDataString) as unknown;
      if (parsed != null && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const vehicleModelsUnknown = obj["vehicleModels"];
        const modelProfilesUnknown = obj["modelProfiles"];

        const isRecord = (x: unknown): x is Record<string, unknown> =>
          x != null && typeof x === "object" && !Array.isArray(x);

        if (isRecord(vehicleModelsUnknown) && isRecord(modelProfilesUnknown)) {
          const vehicleModels = vehicleModelsUnknown;
          const modelProfiles = modelProfilesUnknown;
          const profiles = Object.entries(vehicleModels).reduce(
            (acc, [uniqueVehicleId, modelKeyUnknown]) => {
              if (
                typeof modelKeyUnknown !== "string" ||
                modelKeyUnknown === ""
              ) {
                logger.warn(
                  { uniqueVehicleId, modelKey: modelKeyUnknown },
                  "Invalid vehicle model key in profile message",
                );
                return acc;
              }
              const csvUnknown = modelProfiles[modelKeyUnknown];
              if (typeof csvUnknown === "string" && csvUnknown.length > 0) {
                acc[uniqueVehicleId] = csvUnknown;
              } else {
                logger.warn(
                  { uniqueVehicleId, modelKey: modelKeyUnknown },
                  "No CSV profile found for vehicle model",
                );
              }
              return acc;
            },
            {} as Record<string, string>,
          );
          const schemaVersion =
            typeof obj["schemaVersion"] === "string"
              ? obj["schemaVersion"]
              : undefined;
          return schemaVersion != null
            ? { profiles, schemaVersion }
            : { profiles };
        }
      }
      return undefined;
    } catch (fallbackErr) {
      logger.error(
        {
          err,
          fallbackErr,
          profileCollectionDataString,
        },
        "Could not parse profile message",
      );
      return undefined;
    }
  }
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
  const collection = parseProfileMessageToCollection(
    logger,
    profileCollectionDataString,
  );
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

const formInitialProfile = async (
  logger: pino.Logger,
  vehicleProfileMap: VehicleProfileMap,
  profileReader: Pulsar.Reader,
): Promise<void> => {
  // Drain any existing backlog first so we end up with the latest profile message.
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  while (profileReader.hasNext()) {
    await updateProfiles(logger, vehicleProfileMap, profileReader);
  }
  // Ensure we have at least one profile before processing APC messages; otherwise
  // we'd start acknowledging input without being able to anonymize correctly.
  while (vehicleProfileMap.size < 1) {
    await updateProfiles(logger, vehicleProfileMap, profileReader);
  }
  /* eslint-enable no-await-in-loop */
};

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
  const { vehicleProfileMap } = config;
  await formInitialProfile(logger, vehicleProfileMap, profileReader);
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
