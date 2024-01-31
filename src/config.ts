import type pino from "pino";
import Pulsar from "pulsar-client";
import * as profileCollection from "./quicktype/profileCollection";
import {
  AcceptedDeviceMap,
  AnonymizationConfig,
  Config,
  PulsarConfig,
  VehicleProfileMap,
} from "./types";
import { createProfileMap } from "./vehicleProfile";

const getRequired = (envVariable: string) => {
  const variable = process.env[envVariable];
  if (variable === undefined) {
    throw new Error(`${envVariable} must be defined`);
  }
  return variable;
};

const getOptional = (envVariable: string) => process.env[envVariable];

const getOptionalBooleanWithDefault = (
  envVariable: string,
  defaultValue: boolean,
) => {
  let result = defaultValue;
  const str = getOptional(envVariable);
  if (str !== undefined) {
    if (!["false", "true"].includes(str)) {
      throw new Error(`${envVariable} must be either "false" or "true"`);
    }
    result = str === "true";
  }
  return result;
};

const getStringMap = (envVariable: string): Map<string, string> => {
  // Check the contents below. Crashing here is fine, too.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const keyValueList = JSON.parse(getRequired(envVariable));
  if (!Array.isArray(keyValueList)) {
    throw new Error(`${envVariable} must be a an array`);
  }
  const map = new Map<string, string>(keyValueList);
  if (map.size < 1) {
    throw new Error(
      `${envVariable} must have at least one array entry in the form of [string, string].`,
    );
  }
  if (map.size !== keyValueList.length) {
    throw new Error(`${envVariable} must have each key only once.`);
  }
  if (
    Array.from(map.entries())
      .flat(1)
      .some((x) => typeof x !== "string")
  ) {
    throw new Error(
      `${envVariable} must contain only strings in the form of [string, string].`,
    );
  }
  return map;
};

const getAcceptedDeviceMap = (envVariable: string): AcceptedDeviceMap => {
  const stringMap = getStringMap(envVariable);
  Array.from(stringMap.keys()).forEach((key) => {
    const parts = key.split(":");
    if (
      parts.length < 2 ||
      parts.slice(0, -1).join("").length < 1 ||
      parts.slice(-1).join("").length < 1
    ) {
      throw new Error(
        `${envVariable} must have a colon separating non-empty strings in the form of [string:string, string].`,
      );
    }
  });
  return stringMap as AcceptedDeviceMap;
};

const getProfileCollectionBase = (
  logger: pino.Logger,
  envVariable: string,
): VehicleProfileMap => {
  let map: VehicleProfileMap = {
    vehicleModels: new Map(),
    modelProfiles: new Map(),
  };
  const string = getOptional(envVariable);
  if (string != null) {
    try {
      const collection = profileCollection.Convert.toProfileCollection(string);
      const possibleMap = createProfileMap(logger, collection);
      if (possibleMap != null) {
        map = possibleMap;
      }
    } catch (err) {
      throw new Error(
        `If given, ${envVariable} must contain JSON representing a valid profile collection. Instead, this was given: ${string}`,
      );
    }
  }
  return map;
};

const getAnonymizationConfig = (logger: pino.Logger): AnonymizationConfig => {
  const feedPublisherWalttiAuthorityMap = getStringMap("AUTHORITY_MAP");
  const acceptedDeviceMap = getAcceptedDeviceMap("ACCEPTED_DEVICE_MAP");
  const profileCollectionBase = getProfileCollectionBase(
    logger,
    "PROFILE_COLLECTION_BASE",
  );
  const isInitialProfileReadingRequired = getOptionalBooleanWithDefault(
    "IS_INITIAL_PROFILE_READING_REQUIRED",
    true,
  );
  return {
    feedPublisherWalttiAuthorityMap,
    acceptedDeviceMap,
    profileCollectionBase,
    isInitialProfileReadingRequired,
  };
};

const getPulsarOauth2Config = () => ({
  // pulsar-client requires "type" but that seems unnecessary
  type: "client_credentials",
  issuer_url: getRequired("PULSAR_OAUTH2_ISSUER_URL"),
  private_key: getRequired("PULSAR_OAUTH2_KEY_PATH"),
  audience: getRequired("PULSAR_OAUTH2_AUDIENCE"),
});

const createPulsarLog =
  (logger: pino.Logger) =>
  (
    level: Pulsar.LogLevel,
    file: string,
    line: number,
    message: string,
  ): void => {
    switch (level) {
      case Pulsar.LogLevel.DEBUG:
        logger.debug({ file, line }, message);
        break;
      case Pulsar.LogLevel.INFO:
        logger.info({ file, line }, message);
        break;
      case Pulsar.LogLevel.WARN:
        logger.warn({ file, line }, message);
        break;
      case Pulsar.LogLevel.ERROR:
        logger.error({ file, line }, message);
        break;
      default: {
        const exhaustiveCheck: never = level;
        throw new Error(String(exhaustiveCheck));
      }
    }
  };

const getPulsarCompressionType = (): Pulsar.CompressionType => {
  const compressionType = getOptional("PULSAR_COMPRESSION_TYPE") ?? "ZSTD";
  // tsc does not understand:
  // if (!["Zlib", "LZ4", "ZSTD", "SNAPPY"].includes(compressionType)) {
  if (
    compressionType !== "Zlib" &&
    compressionType !== "LZ4" &&
    compressionType !== "ZSTD" &&
    compressionType !== "SNAPPY"
  ) {
    throw new Error(
      "If defined, PULSAR_COMPRESSION_TYPE must be one of 'Zlib', 'LZ4', " +
        "'ZSTD' or 'SNAPPY'. Default is 'ZSTD'.",
    );
  }
  return compressionType;
};

const getPulsarConfig = (logger: pino.Logger): PulsarConfig => {
  const oauth2Config = getPulsarOauth2Config();
  const serviceUrl = getRequired("PULSAR_SERVICE_URL");
  const tlsValidateHostname = getOptionalBooleanWithDefault(
    "PULSAR_TLS_VALIDATE_HOSTNAME",
    true,
  );
  const log = createPulsarLog(logger);
  const producerTopic = getRequired("PULSAR_PRODUCER_TOPIC");
  const blockIfQueueFull = getOptionalBooleanWithDefault(
    "PULSAR_BLOCK_IF_QUEUE_FULL",
    true,
  );
  const compressionType = getPulsarCompressionType();
  const profileReaderTopic = getRequired("PULSAR_PROFILE_READER_TOPIC");
  const profileReaderName = getRequired("PULSAR_PROFILE_READER_NAME");
  // As we cannot select to start on the last message but right after,
  // set to start at the beginning. If you change the value, review the logic in
  // getLatestMessage from messageProcessing.ts.
  const profileReaderStartMessageId = Pulsar.MessageId.earliest();
  const apcConsumerTopicsPattern = getRequired(
    "PULSAR_APC_CONSUMER_TOPICS_PATTERN",
  );
  const apcSubscription = getRequired("PULSAR_APC_SUBSCRIPTION");
  const apcSubscriptionType = "Exclusive";
  const apcSubscriptionInitialPosition = "Earliest";
  return {
    oauth2Config,
    clientConfig: {
      serviceUrl,
      tlsValidateHostname,
      log,
    },
    producerConfig: {
      topic: producerTopic,
      blockIfQueueFull,
      compressionType,
    },
    profileReaderConfig: {
      topic: profileReaderTopic,
      readerName: profileReaderName,
      startMessageId: profileReaderStartMessageId,
    },
    apcConsumerConfig: {
      topicsPattern: apcConsumerTopicsPattern,
      subscription: apcSubscription,
      subscriptionType: apcSubscriptionType,
      subscriptionInitialPosition: apcSubscriptionInitialPosition,
    },
  };
};

const getHealthCheckConfig = () => {
  const port = parseInt(getOptional("HEALTH_CHECK_PORT") ?? "8080", 10);
  return { port };
};

const getConfig = (logger: pino.Logger): Config => ({
  anonymization: getAnonymizationConfig(logger),
  pulsar: getPulsarConfig(logger),
  healthCheck: getHealthCheckConfig(),
});

export default getConfig;
