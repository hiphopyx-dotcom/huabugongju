import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedViewRules,
  judgeViewQa,
  layoutFromText,
  shouldPersistViewStill,
  VIEW_QA_FAIL,
} from "../public/studio/scene-spec.mjs";

test("shouldPersistViewStill is false on mismatch or empty still", () => {
  assert.equal(shouldPersistViewStill("", { pass: true }), false);
  assert.equal(shouldPersistViewStill(undefined, { pass: true }), false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", { pass: false }), false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", null), false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", { pass: true }), true);
});

test("living-room south sofa mismatch never persists a fake door still", () => {
  const scene = layoutFromText("客厅", "内景 客厅 日", "南面沙发和边桌，西面门，东面窗");
  const rules = expectedViewRules(scene, 1);
  const qa = judgeViewQa(rules, {
    pass: true,
    people: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    openings: { far: ["door"], left: ["window"], right: ["door"] },
    furniture: ["sofa", "table", "door"],
    farFurniture: ["door"],
    missing: [],
    extra: [],
    errors: [],
  });
  assert.equal(qa.pass, false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,FAKE", qa), false);
});

test("qa pass is required even if the model returned an image", () => {
  const club = layoutFromText("夜总会包间", "内景 夜总会包间 夜", "");
  const rules = expectedViewRules(club, 1);
  const bad = judgeViewQa(rules, {
    pass: false,
    people: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    openings: { far: [], left: ["window"], right: ["door"] },
    furniture: ["sofa", "platform", "pole"],
    farFurniture: ["sofa"],
    errors: ["invented-far-door"],
  });
  assert.equal(bad.pass, false);
  assert.equal(shouldPersistViewStill("https://cdn.example/view_n.jpg", bad), false);
});

test("shouldPersistViewStill helper still fail-closes on mismatch", () => {
  assert.equal(VIEW_QA_FAIL, "机位和俯视白膜对不上，未保存");
  assert.equal(shouldPersistViewStill("https://cdn.example/view_n.jpg", { pass: false }), false);
  assert.equal(shouldPersistViewStill("https://cdn.example/view_n.jpg", { pass: true }), true);
});
