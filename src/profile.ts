// eslint-disable-next-line import/no-unresolved
import csvParse from "csv-parse/sync";
// FIXME: later
// import type pino from "pino";
import gcusumkbn2 from "@stdlib/blas-ext-base-gcusumkbn2";
// FIXME: this is temporary workaround
// eslint-disable-next-line import/no-cycle
import { UniqueVehicleId, VehicleProfileMap } from "./config";
// FIXME: later
// import * as profileCollection from "./quicktype/profileCollection";
import type { ProfileCollection } from "./quicktype/profileCollection";

const createProfileMap = (
  // FIXME: not needed yet
  // logger: pino.Logger,
  collection: ProfileCollection,
): VehicleProfileMap => {
  const map: VehicleProfileMap = new Map();
  const { profiles } = collection;
  Object.keys(profiles).forEach((uniqueVehicleId) => {
    // TypeScript does not infer that undefined is impossible so use "as".
    const csvString = profiles[uniqueVehicleId] as string;

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
      // FIXME: logger.error()
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
    map.set(uniqueVehicleId as UniqueVehicleId, { categories, cdf });

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
  });
  return map;
};

export default createProfileMap;
