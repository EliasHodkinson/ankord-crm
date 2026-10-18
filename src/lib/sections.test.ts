import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTIONS, isSection, sectionsFrom } from "./sections";

test("nothing stored means every section", () => {
  assert.deepEqual(sectionsFrom(null), [...SECTIONS]);
  assert.deepEqual(sectionsFrom(undefined), [...SECTIONS]);
});

test("an empty list means none, not all", () => {
  assert.deepEqual(sectionsFrom([]), []);
});

test("a stored list is kept in canonical order, unknown names dropped", () => {
  assert.deepEqual(sectionsFrom(["projects", "reports", "tasks", "customers"]), [
    "tasks",
    "customers",
    "projects",
  ]);
});

test("isSection", () => {
  assert.equal(isSection("sales"), true);
  assert.equal(isSection("leads"), false);
  assert.equal(isSection(undefined), false);
});
