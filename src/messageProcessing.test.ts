import { updateMap } from "./messageProcessing";

describe("updateMap", () => {
  test("Update empty Map", () => {
    const x = new Map();
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
  test("Update non-empty Map", () => {
    const x = new Map([["c", 3]]);
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
  test("Update non-empty Map with key overlap", () => {
    const x = new Map([["a", 3]]);
    const y = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    updateMap(x, y);
    expect(x).toStrictEqual(y);
  });
});
