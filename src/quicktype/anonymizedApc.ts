// @ts-nocheck
// To parse this data:
//
//   import { Convert, AnonymizedApc } from "./file";
//
//   const anonymizedApc = Convert.toAnonymizedApc(json);
//
// These functions will throw an error if the JSON doesn't
// match the expected interface, even if the JSON is valid.

/**
 * Anonymized automatic passenger counting (APC) results per trip and stop.
 */
export interface AnonymizedApc {
  /**
   * Authority ID as used by Waltti, e.g. '203' for Hämeenlinna. Identifiers listed here:
   * https://opendata.waltti.fi/docs#gtfs-static-packages .
   */
  authorityId: string;
  /**
   * current_stop_sequence from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-vehicleposition .
   */
  currentStopSequence: number;
  /**
   * direction_id from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-tripdescriptor .
   */
  directionId: number;
  /**
   * occupancy_status from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-vehicleposition . Only values from 'EMPTY'
   * to 'FULL' are provided via these messages. If no anonymized APC message is available for
   * a particular trip, then use the value 'NO_DATA_AVAILABLE', unless you know that either
   * 'NOT_ACCEPTING_PASSENGERS' or 'NOT_BOARDABLE' is more appropriate.
   */
  occupancyStatus: OccupancyStatus;
  /**
   * route_id from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-tripdescriptor .
   */
  routeId: string;
  /**
   * The SchemaVer version number of the JSON schema that this message follows. A valid value
   * is for example '1-0-0'.
   */
  schemaVersion: string;
  /**
   * start_date from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-tripdescriptor . Operating date might be
   * longer than 24 hours.
   */
  startDate: string;
  /**
   * start_time from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-tripdescriptor . Operating date might be
   * longer than 24 hours.
   */
  startTime: string;
  /**
   * stop_id from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-vehicleposition .
   */
  stopId: string;
  /**
   * A timestamp for when the data was generated. An ISO 8601 UTC timestamp in the strftime
   * format '%Y-%m-%dT%H:%M:%S.%fZ' where '%f' means milliseconds zero-padded on the left. A
   * valid value would be e.g. '2022-11-22T11:27:31.847Z'.
   */
  timestamp: string;
  /**
   * trip_id from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-tripdescriptor
   */
  tripId: string;
  /**
   * Vehicle ID i.e. VehicleDescriptor.id from the GTFS Realtime specification:
   * https://gtfs.org/realtime/reference/#message-vehicledescriptor .
   */
  vehicleId: string;
  [property: string]: any;
}

/**
 * occupancy_status from the GTFS Realtime specification:
 * https://gtfs.org/realtime/reference/#message-vehicleposition . Only values from 'EMPTY'
 * to 'FULL' are provided via these messages. If no anonymized APC message is available for
 * a particular trip, then use the value 'NO_DATA_AVAILABLE', unless you know that either
 * 'NOT_ACCEPTING_PASSENGERS' or 'NOT_BOARDABLE' is more appropriate.
 */
export enum OccupancyStatus {
  CrushedStandingRoomOnly = "CRUSHED_STANDING_ROOM_ONLY",
  Empty = "EMPTY",
  FewSeatsAvailable = "FEW_SEATS_AVAILABLE",
  Full = "FULL",
  ManySeatsAvailable = "MANY_SEATS_AVAILABLE",
  StandingRoomOnly = "STANDING_ROOM_ONLY",
}

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
export class Convert {
  public static toAnonymizedApc(json: string): AnonymizedApc {
    return cast(JSON.parse(json), r("AnonymizedApc"));
  }

  public static anonymizedApcToJson(value: AnonymizedApc): string {
    return JSON.stringify(uncast(value, r("AnonymizedApc")), null, 2);
  }
}

function invalidValue(typ: any, val: any, key: any, parent: any = ""): never {
  const prettyTyp = prettyTypeName(typ);
  const parentText = parent ? ` on ${parent}` : "";
  const keyText = key ? ` for key "${key}"` : "";
  throw Error(
    `Invalid value${keyText}${parentText}. Expected ${prettyTyp} but got ${JSON.stringify(val)}`,
  );
}

function prettyTypeName(typ: any): string {
  if (Array.isArray(typ)) {
    if (typ.length === 2 && typ[0] === undefined) {
      return `an optional ${prettyTypeName(typ[1])}`;
    } else {
      return `one of [${typ
        .map((a) => {
          return prettyTypeName(a);
        })
        .join(", ")}]`;
    }
  } else if (typeof typ === "object" && typ.literal !== undefined) {
    return typ.literal;
  } else {
    return typeof typ;
  }
}

function jsonToJSProps(typ: any): any {
  if (typ.jsonToJS === undefined) {
    const map: any = {};
    typ.props.forEach((p: any) => (map[p.json] = { key: p.js, typ: p.typ }));
    typ.jsonToJS = map;
  }
  return typ.jsonToJS;
}

function jsToJSONProps(typ: any): any {
  if (typ.jsToJSON === undefined) {
    const map: any = {};
    typ.props.forEach((p: any) => (map[p.js] = { key: p.json, typ: p.typ }));
    typ.jsToJSON = map;
  }
  return typ.jsToJSON;
}

function transform(
  val: any,
  typ: any,
  getProps: any,
  key: any = "",
  parent: any = "",
): any {
  function transformPrimitive(typ: string, val: any): any {
    if (typeof typ === typeof val) return val;
    return invalidValue(typ, val, key, parent);
  }

  function transformUnion(typs: any[], val: any): any {
    // val must validate against one typ in typs
    const l = typs.length;
    for (let i = 0; i < l; i++) {
      const typ = typs[i];
      try {
        return transform(val, typ, getProps);
      } catch (_) {}
    }
    return invalidValue(typs, val, key, parent);
  }

  function transformEnum(cases: string[], val: any): any {
    if (cases.indexOf(val) !== -1) return val;
    return invalidValue(
      cases.map((a) => {
        return l(a);
      }),
      val,
      key,
      parent,
    );
  }

  function transformArray(typ: any, val: any): any {
    // val must be an array with no invalid elements
    if (!Array.isArray(val)) return invalidValue(l("array"), val, key, parent);
    return val.map((el) => transform(el, typ, getProps));
  }

  function transformDate(val: any): any {
    if (val === null) {
      return null;
    }
    const d = new Date(val);
    if (isNaN(d.valueOf())) {
      return invalidValue(l("Date"), val, key, parent);
    }
    return d;
  }

  function transformObject(
    props: { [k: string]: any },
    additional: any,
    val: any,
  ): any {
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
      return invalidValue(l(ref || "object"), val, key, parent);
    }
    const result: any = {};
    Object.getOwnPropertyNames(props).forEach((key) => {
      const prop = props[key];
      const v = Object.prototype.hasOwnProperty.call(val, key)
        ? val[key]
        : undefined;
      result[prop.key] = transform(v, prop.typ, getProps, key, ref);
    });
    Object.getOwnPropertyNames(val).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(props, key)) {
        result[key] = transform(val[key], additional, getProps, key, ref);
      }
    });
    return result;
  }

  if (typ === "any") return val;
  if (typ === null) {
    if (val === null) return val;
    return invalidValue(typ, val, key, parent);
  }
  if (typ === false) return invalidValue(typ, val, key, parent);
  let ref: any = undefined;
  while (typeof typ === "object" && typ.ref !== undefined) {
    ref = typ.ref;
    typ = typeMap[typ.ref];
  }
  if (Array.isArray(typ)) return transformEnum(typ, val);
  if (typeof typ === "object") {
    return typ.hasOwnProperty("unionMembers")
      ? transformUnion(typ.unionMembers, val)
      : typ.hasOwnProperty("arrayItems")
        ? transformArray(typ.arrayItems, val)
        : typ.hasOwnProperty("props")
          ? transformObject(getProps(typ), typ.additional, val)
          : invalidValue(typ, val, key, parent);
  }
  // Numbers can be parsed by Date but shouldn't be.
  if (typ === Date && typeof val !== "number") return transformDate(val);
  return transformPrimitive(typ, val);
}

function cast<T>(val: any, typ: any): T {
  return transform(val, typ, jsonToJSProps);
}

function uncast<T>(val: T, typ: any): any {
  return transform(val, typ, jsToJSONProps);
}

function l(typ: any) {
  return { literal: typ };
}

function a(typ: any) {
  return { arrayItems: typ };
}

function u(...typs: any[]) {
  return { unionMembers: typs };
}

function o(props: any[], additional: any) {
  return { props, additional };
}

function m(additional: any) {
  return { props: [], additional };
}

function r(name: string) {
  return { ref: name };
}

const typeMap: any = {
  AnonymizedApc: o(
    [
      { json: "authorityId", js: "authorityId", typ: "" },
      { json: "currentStopSequence", js: "currentStopSequence", typ: 0 },
      { json: "directionId", js: "directionId", typ: 0 },
      {
        json: "occupancyStatus",
        js: "occupancyStatus",
        typ: r("OccupancyStatus"),
      },
      { json: "routeId", js: "routeId", typ: "" },
      { json: "schemaVersion", js: "schemaVersion", typ: "" },
      { json: "startDate", js: "startDate", typ: "" },
      { json: "startTime", js: "startTime", typ: "" },
      { json: "stopId", js: "stopId", typ: "" },
      { json: "timestamp", js: "timestamp", typ: "" },
      { json: "tripId", js: "tripId", typ: "" },
      { json: "vehicleId", js: "vehicleId", typ: "" },
    ],
    "any",
  ),
  OccupancyStatus: [
    "CRUSHED_STANDING_ROOM_ONLY",
    "EMPTY",
    "FEW_SEATS_AVAILABLE",
    "FULL",
    "MANY_SEATS_AVAILABLE",
    "STANDING_ROOM_ONLY",
  ],
};
