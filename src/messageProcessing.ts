import type pino from "pino";
import type Pulsar from "pulsar-client";
import type {
  AnonymizationConfig,
  UniqueVehicleId,
  VehiclePassengerCountMap,
  VehicleProfile,
} from "./types";
import * as anonymizedApc from "./quicktype/anonymizedApc";
import * as matchedApc from "./quicktype/matchedApc";
import { anonymize } from "./anonymization";
import { createVehicleProfileSearch } from "./vehicleProfile";
import { createVehicleRegistryHandler } from "./vehicleRegistry";

/**
 * Get the latest message with the reader.
 *
 * If there are no messages in the topic, we wait for the next message. If there
 * are messages in the topic, we start a search for the latest message backwards
 * from the current time.
 *
 * If the topic is empty, wait for the next message.
 *
 * If at some point the Pulsar client allows us to get directly to the last
 * message and not after it, refactor to use that approach.
 *
 * @param reader The Pulsar Reader to read from.
 * @param stepInSeconds How far back do we step from the current moment to start
 *   looking for messages in the topic. The default is one week.
 * @returns The latest message in the topic.
 */
const getLatestMessage = async (
  reader: Pulsar.Reader,
  stepInSeconds: number = 60 * 60 * 24 * 7,
): Promise<Pulsar.Message> => {
  let message: Pulsar.Message;
  // In getPulsarConfig from config.ts the reader was hard coded to start from
  // the beginning of the topic. Rely on that.
  const isAnyMessageInTopic = reader.hasNext();
  if (isAnyMessageInTopic) {
    // Search exponentially further back until one or more messages become
    // available.
    const now = Date.now();
    let stepInMilliseconds = 1_000 * stepInSeconds;
    let seekTimeInMilliseconds = now - stepInMilliseconds;
    await reader.seekTimestamp(seekTimeInMilliseconds);
    /* eslint-disable no-await-in-loop */
    while (!reader.hasNext()) {
      stepInMilliseconds *= 2;
      seekTimeInMilliseconds = now - stepInMilliseconds;
      await reader.seekTimestamp(seekTimeInMilliseconds);
    }
    while (reader.hasNext()) {
      message = await reader.readNext();
    }
    /* eslint-enable no-await-in-loop */
  } else {
    message = await reader.readNext();
  }
  // TypeScript does not understand reader.hasNext() behavior so claims that
  // message might be undefined. Use the non-null assertion operator.
  return message!;
};

const keepUpdatingProfiles = async (
  logger: pino.Logger,
  update: (message: Pulsar.Message) => void,
  profileReader: Pulsar.Reader,
) => {
  logger.info("Starting profile update loop");
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    logger.debug("Waiting for next profile message...");
    const message = await profileReader.readNext();
    logger.info(
      {
        messageId: message.getMessageId().toString(),
        eventTimestamp: message.getEventTimestamp(),
        dataSize: message.getData().length,
      },
      "Received profile message",
    );
    update(message);
  }
  /* eslint-enable no-await-in-loop */
};

const keepUpdatingVehicleRegistry = async (
  logger: pino.Logger,
  update: (message: Pulsar.Message) => void,
  vehicleRegistryConsumer: Pulsar.Consumer,
) => {
  logger.info("Starting vehicle registry update loop");
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    logger.debug("Waiting for next vehicle registry message...");
    const message = await vehicleRegistryConsumer.receive();
    logger.info(
      {
        messageId: message.getMessageId().toString(),
        eventTimestamp: message.getEventTimestamp(),
        topic: message.getTopicName(),
        dataSize: message.getData().length,
      },
      "Received vehicle registry message",
    );
    update(message);
    await vehicleRegistryConsumer.acknowledge(message);
  }
  /* eslint-enable no-await-in-loop */
};

const handleApcMessage = (
  logger: pino.Logger,
  lookup: (uniqueVehicleId: UniqueVehicleId) => VehicleProfile | undefined,
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
      lookup,
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
  lookup: (uniqueVehicleId: UniqueVehicleId) => VehicleProfile | undefined,
  apcConsumer: Pulsar.Consumer,
  producer: Pulsar.Producer,
  config: AnonymizationConfig,
) => {
  const countCache: VehiclePassengerCountMap = new Map();
  logger.info("Starting APC message processing loop");
  let messageCount = 0;
  let producedCount = 0;
  let skippedCount = 0;
  // Errors are handled in the calling function.
  /* eslint-disable no-await-in-loop */
  for (;;) {
    const apcPulsarMessage = await apcConsumer.receive();
    messageCount += 1;
    const anonymizedPulsarMessage = handleApcMessage(
      logger,
      lookup,
      countCache,
      apcPulsarMessage,
      config,
    );
    if (anonymizedPulsarMessage != null) {
      producedCount += 1;
      // In case of an error, exit via the listener on unhandledRejection.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      producer.send(anonymizedPulsarMessage).then(() => {
        // In case of an error, exit via the listener on unhandledRejection.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        apcConsumer.acknowledge(apcPulsarMessage);
      });
    } else {
      skippedCount += 1;
      await apcConsumer.acknowledge(apcPulsarMessage);
    }
    // Log progress every 100 messages
    if (messageCount % 100 === 0) {
      logger.info(
        { messageCount, producedCount, skippedCount },
        "APC message processing progress",
      );
    }
  }
  /* eslint-enable no-await-in-loop */
};

const keepProcessingMessages = async (
  logger: pino.Logger,
  producer: Pulsar.Producer,
  profileReader: Pulsar.Reader,
  apcConsumer: Pulsar.Consumer,
  config: AnonymizationConfig,
  vehicleRegistryConsumer?: Pulsar.Consumer,
): Promise<void> => {
  const {
    isInitialProfileReadingRequired,
    profileCollectionBase,
    acceptedDeviceMap,
    feedPublisherWalttiAuthorityMap,
  } = config;
  const { lookup, update } = createVehicleProfileSearch(
    logger,
    profileCollectionBase,
  );
  if (isInitialProfileReadingRequired) {
    const message = await getLatestMessage(profileReader);
    update(message);
  }

  const promises: Promise<void>[] = [
    keepUpdatingProfiles(logger, update, profileReader),
    keepSendingAnonymizedApc(logger, lookup, apcConsumer, producer, config),
  ];

  // If vehicle registry consumer is configured, add the update loop
  if (vehicleRegistryConsumer) {
    const { update: updateVehicleRegistry } = createVehicleRegistryHandler(
      logger,
      acceptedDeviceMap,
      feedPublisherWalttiAuthorityMap,
    );
    // Seek to the beginning so we re-read all retained vehicle catalogue
    // messages on every startup. Without this, the consumer's acknowledged
    // cursor position means it would wait for the next new message (up to 6 h).
    logger.info(
      "Seeking vehicle registry consumer to the beginning of the topic",
    );
    await vehicleRegistryConsumer.seekTimestamp(0);
    // Read all currently available messages to populate the map before
    // processing APC messages.
    logger.info("Reading initial vehicle registry messages...");
    let initialCount = 0;
    try {
      // Use a short timeout to drain all available messages
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const message = await vehicleRegistryConsumer.receive(2000);
        updateVehicleRegistry(message);
        // eslint-disable-next-line no-await-in-loop
        await vehicleRegistryConsumer.acknowledge(message);
        initialCount += 1;
      }
    } catch {
      // Timeout means we have read all currently available messages
    }
    logger.info(
      {
        initialMessagesRead: initialCount,
        mapSize: acceptedDeviceMap.size,
      },
      "Initial vehicle registry loading complete",
    );
    promises.push(
      keepUpdatingVehicleRegistry(
        logger,
        updateVehicleRegistry,
        vehicleRegistryConsumer,
      ),
    );
  } else {
    logger.info(
      { mapSize: acceptedDeviceMap.size },
      "No vehicle registry consumer configured, using static acceptedDeviceMap",
    );
  }

  // We expect all promises to stay pending.
  await Promise.any(promises);
};

export default keepProcessingMessages;
