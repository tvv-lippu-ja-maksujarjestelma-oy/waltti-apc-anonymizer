import type Pulsar from "pulsar-client";
import type { MatchedApc } from "./quicktype/matchedApc";

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

export type VehicleModel = string;

export type VehicleModelMap = Map<UniqueVehicleId, VehicleModel>;
export type ModelProfileMap = Map<VehicleModel, VehicleProfile>;

export interface VehicleProfileMap {
  vehicleModels: VehicleModelMap;
  modelProfiles: ModelProfileMap;
}

// Base is never explicitly cleared even though it can be overwritten, so we
// keep it separate.
export interface VehicleProfileMapWithBase {
  base: VehicleProfileMap;
}

export type AcceptedDeviceMap = Map<UniqueVehicleId, CountingDeviceId>;

export interface AnonymizationConfig {
  feedPublisherWalttiAuthorityMap: Map<WalttiAuthorityId, FeedPublisherId>;
  acceptedDeviceMap: AcceptedDeviceMap;
  profileCollectionBase: VehicleProfileMap;
  isInitialProfileReadingRequired: boolean;
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
  oauth2Config: PulsarOauth2Config;
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
