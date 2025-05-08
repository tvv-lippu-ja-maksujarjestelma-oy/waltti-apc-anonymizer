// eslint-disable-next-line import/no-unresolved
import csvParse from "csv-parse/sync";
import type pino from "pino";
import type Pulsar from "pulsar-client";
import gcusumkbn2 from "@stdlib/blas-ext-base-gcusumkbn2";
import * as profileCollection from "./quicktype/profileCollection";
import type {
  ModelProfileMap,
  UniqueVehicleId,
  VehicleModelMap,
  VehicleProfile,
  VehicleProfileMap,
} from "./types";

const areModelsConsistent = (
  vehicleModels: { [key: string]: string },
  modelProfiles: { [key: string]: string },
): boolean => {
  const values = new Set(Object.values(vehicleModels));
  const keys = new Set(Object.keys(modelProfiles));
  const allValuesInKeys = [...values].every((value) => keys.has(value));
  const allKeysInValues = [...keys].every((key) => values.has(key));
  return allValuesInKeys && allKeysInValues;
};

export const createProfileMap = (
  logger: pino.Logger,
  collection: profileCollection.ProfileCollection,
): VehicleProfileMap | undefined => {
  const {
    vehicleModels: givenVehicleModels,
    modelProfiles: givenModelProfiles,
  } = collection;
  if (!areModelsConsistent(givenVehicleModels, givenModelProfiles)) {
    logger.error(
      { vehicleModels: givenVehicleModels, modelProfiles: givenModelProfiles },
      "In the vehicle profile not all models in vehicleModels could be found from the models in modelProfiles, or vice versa.",
    );
    return undefined;
  }
  if (Object.keys(givenVehicleModels).some((key) => !key.includes(":"))) {
    logger.error(
      { vehicleModels: givenVehicleModels },
      'Each unique vehicle ID must have the character ":" in it as a separator',
    );
    return undefined;
  }
  const modelProfiles: ModelProfileMap = new Map();
  Object.keys(givenModelProfiles).forEach((model) => {
    // TypeScript does not infer that undefined is impossible so use "as".
    const csvString = givenModelProfiles[model] as string;

    // FIXME: no error handling yet
    // // FIXME: check header has >= 2 columns
    // // FIXME: check passenger_count exists
    // // FIXME: check no nulls or NaNs or Infinitys (isNumber)
    // // FIXME: check first column in order from 0 to n
    // // FIXME: remove first column
    // // FIXME: check all values at most 1.0 and at least 0.0
    // // NOFIXME: check header length minus passengerCount is same as row lengths for all rows

    // FIXME: explicit type might need changes
    let records: [string[], ...number[][]];
    try {
      // FIXME: maybe do not use cast or as later on
      records = csvParse.parse(csvString, { cast: true }) as [
        string[],
        ...number[][],
      ];
    } catch (err) {
      logger.error(
        { model, csvString },
        "csvString could not be parsed as CSV. Let's use the rest of the models, though.",
      );
      return;
    }
    const categories = records[0].slice(1);
    const dataRows = records.slice(1) as number[][];
    const cdf = dataRows
      .map((row) => row.slice(1))
      .map((row) => {
        const input = new Float64Array(row);
        const output = new Float64Array(row.length);
        gcusumkbn2(row.length, 0.0, input, 1, output, 1);
        const last = output.at(-1) as number;
        const normalized = output.map((elem) => elem / last);
        return normalized;
      });
    modelProfiles.set(model, { categories, cdf });
  });
  return {
    // The vehicle IDs contain ":" as checked for above.
    vehicleModels: new Map(
      Object.entries(givenVehicleModels),
    ) as VehicleModelMap,
    modelProfiles,
  };

  // FIXME: old error handling code
  // if (records.length < 2) {
  //   logger.error({uniqueVehicleId, records}, "The CSV string for a vehicle must have at least the header and one row.")
  // } else {
  //   const header = records[0];
  //   if (header.length < 2) {
  //     logger.error({uniqueVehicleId, records}, "The CSV data must have at least two columns.")
  //   } else if (header.some(elem => typeof elem !== 'string' || elem === '') {
  //     logger.error({uniqueVehicleId, records}, "The CSV data must have at least two columns.")
  //   }
  // type; // of elem)) {}
  // } else if (records.some(row => row.length !== (records?[0].length))) {
  //     logger.error({uniqueVehicleId, records}, "The CSV data must have the same amount of columns as the header.")
  // } else if (records.some(row => row.some(elem => !Number.isFinite(elem) || elem < 0))) {
  //     logger.error(uniqueVehicleId, records}, "The CSV data must")
  // } else {
  //     const categories = header.slice(1);
  //     const nCategories = categories.length;
  //     if (records.all(row => row.length === nCategories)

  //     const dataRows = records.slice(1);
  // }
};

const removeKeyOverlap = <K, V>(
  removed: Map<K, V>,
  remover: Map<K, V>,
): void => {
  Array.from(remover.keys()).forEach((key) => removed.delete(key));
};

const mergeMaps = <K, V>(map1: Map<K, V>, map2: Map<K, V>): Map<K, V> => {
  return new Map([...map1, ...map2]);
};

export const createVehicleProfileSearch = (
  logger: pino.Logger,
  initialBase: VehicleProfileMap,
): {
  lookup: (uniqueVehicleId: UniqueVehicleId) => VehicleProfile | undefined;
  update: (message: Pulsar.Message) => void;
} => {
  const baseMap: VehicleProfileMap = {
    vehicleModels: new Map(initialBase.vehicleModels),
    modelProfiles: new Map(initialBase.modelProfiles),
  };
  let vehicleModels: VehicleModelMap;
  let modelProfiles: ModelProfileMap;

  const lookup = (
    uniqueVehicleId: UniqueVehicleId,
  ): VehicleProfile | undefined => {
    let result;
    const model = vehicleModels.get(uniqueVehicleId);
    if (model != null) {
      result = modelProfiles.get(model);
    }
    return result;
  };

  const update = (profileCollectionMessage: Pulsar.Message): void => {
    const profileCollectionMessageDataString = profileCollectionMessage
      .getData()
      .toString("utf8");
    let collection;
    try {
      collection = profileCollection.Convert.toProfileCollection(
        profileCollectionMessageDataString,
      );
    } catch (err) {
      logger.error(
        {
          err,
          profileCollectionMessageEventTimestamp:
            profileCollectionMessage.getEventTimestamp(),
          profileCollectionMessageProperties: {
            ...profileCollectionMessage.getProperties(),
          },
          profileCollectionMessageDataString,
        },
        "Could not parse profileCollectionMessage",
      );
    }
    if (collection != null) {
      let newVehicleProfileMap;
      try {
        newVehicleProfileMap = createProfileMap(logger, collection);
      } catch (err) {
        logger.error(
          { err, collection },
          "Could not create vehicle profile map",
        );
      }
      if (newVehicleProfileMap != null) {
        // If ever baseMap is overridden, the old values should not be used.
        removeKeyOverlap(
          baseMap.vehicleModels,
          newVehicleProfileMap.vehicleModels,
        );
        removeKeyOverlap(
          baseMap.modelProfiles,
          newVehicleProfileMap.modelProfiles,
        );
        vehicleModels = mergeMaps(
          baseMap.vehicleModels,
          newVehicleProfileMap.vehicleModels,
        );
        modelProfiles = mergeMaps(
          baseMap.modelProfiles,
          newVehicleProfileMap.modelProfiles,
        );
      }
    }
  };

  return { lookup, update };
};
