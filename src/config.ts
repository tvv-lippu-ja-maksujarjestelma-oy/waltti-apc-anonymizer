import type pino from "pino";
import Pulsar from "pulsar-client";
import type { SubscriptionType, InitialPosition } from "pulsar-client";
import fs from "node:fs";
import type { MatchedApc } from "./quicktype/matchedApc";
// FIXME: this is temporary workaround
// eslint-disable-next-line import/no-cycle
import createProfileMap from "./profile";

export type CountingDeviceId = string;

export type FeedPublisherId = string;

export type WalttiAuthorityId = string;

export type VehicleId = string;

export type UniqueVehicleId = `${FeedPublisherId}:${VehicleId}`;

export type CountingVendorName = MatchedApc["countingVendorName"];

export type CountingSystemMap = Map<
  CountingDeviceId,
  [UniqueVehicleId, CountingVendorName]
>;

export interface UniqueVehicleJourneyId {
  gtfsrtDirectionId: MatchedApc["gtfsrtDirectionId"];
  gtfsrtRouteId: MatchedApc["gtfsrtRouteId"];
  gtfsrtStartDate: MatchedApc["gtfsrtStartDate"];
  gtfsrtStartTime: MatchedApc["gtfsrtStartTime"];
  gtfsrtTripId: MatchedApc["gtfsrtTripId"];
}

export type VehiclePassengerCountMap = Map<
  UniqueVehicleId,
  [UniqueVehicleJourneyId, PassengerCount]
>;

export type TimezoneName = string;

export type FeedMap = Map<
  string,
  [FeedPublisherId, WalttiAuthorityId, TimezoneName]
>;

export type PassengerCount = number;

export interface VehicleProfile {
  categories: string[];
  cdf: Float64Array[];
}

export type VehicleProfileMap = Map<UniqueVehicleId, VehicleProfile>;
export type AcceptedDeviceMap = Map<UniqueVehicleId, CountingDeviceId>;

export interface AnonymizationConfig {
  feedPublisherWalttiAuthorityMap: Map<WalttiAuthorityId, FeedPublisherId>;
  // FIXME: this should be read via Pulsar
  vehicleProfileMap: VehicleProfileMap;
  acceptedDeviceMap: AcceptedDeviceMap;
}

export interface PulsarOauth2Config {
  // pulsar-client requires "type" but that seems unnecessary
  type: string;
  issuer_url: string;
  client_id?: string;
  client_secret?: string;
  private_key?: string;
  audience?: string;
  scope?: string;
}

export interface PulsarConfig {
  oauth2Config?: PulsarOauth2Config;
  clientConfig: Pulsar.ClientConfig;
  producerConfig: Pulsar.ProducerConfig;
  profileReaderConfig: Pulsar.ReaderConfig;
  apcConsumerConfig: Pulsar.ConsumerConfig;
}

export interface HealthCheckConfig {
  port: number;
}

export interface Config {
  anonymization: AnonymizationConfig;
  pulsar: PulsarConfig;
  healthCheck: HealthCheckConfig;
}

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

const getStringMapFromEnvOrFile = (
  envVariable: string,
  fileEnvVariable: string,
): Map<string, string> => {
  const filePath = getOptional(fileEnvVariable);
  let text: string;
  if (filePath != null) {
    try {
      text = fs.readFileSync(filePath, { encoding: "utf8" });
    } catch (err) {
      throw new Error(
        `${fileEnvVariable} points to a file that cannot be read: ${String(err)}`,
      );
    }
  } else {
    text = getRequired(envVariable);
  }
  // Parse JSON only.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const parsed = JSON.parse(text);
  // Normalize accepted shapes into [key, value][]:
  // 1) Array of [string, string]
  // 2) Object { [key: string]: string }
  // 3) Object { profiles: { [key: string]: string } }
  let entries: Array<[string, string]> | undefined;
  if (Array.isArray(parsed)) {
    entries = parsed as Array<[string, string]>;
  } else if (
    parsed != null &&
    typeof parsed === "object" &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (parsed as Record<string, unknown>)["profiles"] != null &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    typeof (parsed as Record<string, unknown>)["profiles"] === "object"
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const profiles = (parsed as Record<string, unknown>)["profiles"] as Record<
      string,
      string
    >;
    entries = Object.entries(profiles);
  } else if (parsed != null && typeof parsed === "object") {
    const obj = parsed as Record<string, string>;
    entries = Object.entries(obj);
  }
  if (entries == null) {
    throw new Error(
      `${
        filePath != null ? fileEnvVariable : envVariable
      } must be an array of [string, string] or an object mapping strings to strings, optionally under 'profiles'.`,
    );
  }
  const map = new Map<string, string>(entries);
  if (map.size < 1) {
    throw new Error(
      `${
        filePath != null ? fileEnvVariable : envVariable
      } must have at least one array entry in the form of [string, string].`,
    );
  }
  if (Array.isArray(parsed)) {
    if (map.size !== (parsed as Array<[string, string]>).length) {
      throw new Error(
        `${filePath != null ? fileEnvVariable : envVariable} must have each key only once.`,
      );
    }
  }
  if (
    Array.from(map.entries())
      .flat(1)
      .some((x) => typeof x !== "string")
  ) {
    throw new Error(
      `${
        filePath != null ? fileEnvVariable : envVariable
      } must contain only strings in the form of [string, string].`,
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

const getVehicleProfileMap = (): VehicleProfileMap => {
  const profiles = getStringMapFromEnvOrFile(
    "VEHICLE_PROFILE_MAP",
    "VEHICLE_PROFILE_MAP_FILE",
  );
  return createProfileMap({ profiles: Object.fromEntries(profiles.entries()) });
};

const getAnonymizationConfig = (): AnonymizationConfig => {
  const feedPublisherWalttiAuthorityMap = getStringMap("AUTHORITY_MAP");
  const vehicleProfileMap = getVehicleProfileMap();
  const acceptedDeviceMap = getAcceptedDeviceMap("ACCEPTED_DEVICE_MAP");
  return {
    feedPublisherWalttiAuthorityMap,
    vehicleProfileMap,
    acceptedDeviceMap,
  };
};

const getPulsarOauth2Config = (): PulsarOauth2Config | undefined => {
  const issuerUrl = getOptional("PULSAR_OAUTH2_ISSUER_URL");
  const privateKey = getOptional("PULSAR_OAUTH2_KEY_PATH");
  const audience = getOptional("PULSAR_OAUTH2_AUDIENCE");

  const anyProvided =
    issuerUrl !== undefined ||
    privateKey !== undefined ||
    audience !== undefined;
  if (!anyProvided) {
    return undefined;
  }

  if (!issuerUrl || !privateKey || !audience) {
    throw new Error(
      "If any of PULSAR_OAUTH2_ISSUER_URL, PULSAR_OAUTH2_KEY_PATH, PULSAR_OAUTH2_AUDIENCE is defined, all must be defined.",
    );
  }

  return {
    // pulsar-client requires "type" but that seems unnecessary
    type: "client_credentials",
    issuer_url: issuerUrl,
    private_key: privateKey,
    audience,
  };
};

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
  // Start from earliest so on restart we can immediately load the latest
  // already-published profile message (by draining backlog) instead of waiting
  // for the next profiler run.
  const profileReaderStartMessageId = Pulsar.MessageId.earliest();
  const apcConsumerTopicsPattern = getRequired(
    "PULSAR_APC_CONSUMER_TOPICS_PATTERN",
  );
  const apcSubscription = getRequired("PULSAR_APC_SUBSCRIPTION");
  const apcSubscriptionType: SubscriptionType = "Exclusive";
  const apcSubscriptionInitialPosition: InitialPosition = "Earliest";
  const base = {
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

  const result = oauth2Config ? { ...base, oauth2Config } : base;

  return result;
};

const getHealthCheckConfig = () => {
  const port = parseInt(getOptional("HEALTH_CHECK_PORT") ?? "8080", 10);
  return { port };
};

export const getConfig = (logger: pino.Logger): Config => ({
  anonymization: getAnonymizationConfig(),
  pulsar: getPulsarConfig(logger),
  healthCheck: getHealthCheckConfig(),
});
