import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CAMERA_WALL_MAP,
  emptyOpeningsScene,
  emptyOpeningGuard,
  emptyRoomWithCenterTable,
  emptyRoomWithSouthSofa,
  expectedViewRules,
  judgeViewQa,
  layoutFromText,
  shouldPersistViewStill,
  skinPrompt,
  viewRefOrder,
  VIEW_QA_FAIL,
} from "../public/studio/scene-spec.mjs";

const empty = () => layoutFromText("空房间开口测试", "内景 空房间 日", "只有西门东窗");

test("empty room is four walls plus south door and west window", () => {
  const s = empty();
  assert.deepEqual(
    s.objects.map((o) => `${o.id}:${o.wall}`).sort(),
    ["door-s:south", "window-w:west"],
  );
  assert.equal(s.objects.some((o) => /sofa|table|bed|counter|bench/i.test(o.type)), false);
  const fromHelper = emptyOpeningsScene();
  assert.equal(fromHelper.objects.length, 2);
});

test("empty room N/E/S/W opening map", () => {
  const s = empty();
  const n = expectedViewRules(s, 1);
  assert.equal(n.openingsOnly, true);
  assert.equal(n.farWall, "south");
  assert.deepEqual(n.farOpenings, ["door"]);
  assert.deepEqual(n.leftOpenings, []);
  assert.deepEqual(n.rightOpenings, ["window"]);
  const w = expectedViewRules(s, 2);
  assert.equal(w.farWall, "east");
  assert.deepEqual(w.farOpenings, []);
  assert.deepEqual(w.rightOpenings, ["door"]);
  const e = expectedViewRules(s, 3);
  assert.equal(e.farWall, "west");
  assert.deepEqual(e.farOpenings, ["window"]);
  assert.deepEqual(e.leftOpenings, ["door"]);
  const sCam = expectedViewRules(s, 4);
  assert.equal(sCam.farWall, "north");
  assert.deepEqual(sCam.leftOpenings, ["window"]);
  assert.deepEqual(sCam.rightOpenings, []);
  assert.equal(CAMERA_WALL_MAP[1].far, "south");
});

test("empty view_n invented far door does not persist", () => {
  const rules = expectedViewRules(empty(), 1);
  const qa = judgeViewQa(rules, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door", "door"], left: [], right: ["window"] },
    furniture: [],
    extra: [],
  });
  assert.equal(VIEW_QA_FAIL, "机位和俯视白膜对不上，未保存");
});

test("empty view_n invented far glass does not persist", () => {
  const rules = expectedViewRules(empty(), 1);
  const qa = judgeViewQa(rules, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: true,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door", "glass"], left: [], right: ["window"] },
    furniture: [],
    extra: [],
  });
  assert.equal(qa.pass, false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), false);
});

test("empty room uncertain or unreadable never persist", () => {
  const rules = expectedViewRules(empty(), 1);
  const good = {
    pass: true,
    people: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door"], left: [], right: ["window"] },
    furniture: [],
  };
  const missingFlag = judgeViewQa(rules, good);
  assert.equal(missingFlag.pass, false);
  const unread = judgeViewQa(rules, undefined);
  assert.deepEqual(unread.errors, ["qa-unreadable"]);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", missingFlag), false);
});

test("empty view_n correct openings persist", () => {
  const rules = expectedViewRules(empty(), 1);
  const qa = judgeViewQa(rules, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door"], left: [], right: ["window"] },
    furniture: [],
    extra: [],
  });
  assert.equal(qa.pass, true);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), true);
});

test("south sofa stage forbids a fake south door", () => {
  const s = emptyRoomWithSouthSofa();
  const rules = expectedViewRules(s, 1);
  const qa = judgeViewQa(rules, {
    pass: true,
    people: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    openings: { far: ["door"], left: ["window"], right: ["door"] },
    furniture: ["sofa"],
    farFurniture: ["door"],
    extra: [],
  });
  assert.equal(qa.pass, false);
});

test("empty view_e prompt forbids copying the east window onto the far wall", () => {
  const scene = empty();
  const prompt = skinPrompt({ scene, camId: 3, manifest: [], place: "日", style: "photoreal" });
  assert.match(prompt, /EMPTY view_e|EMPTY ROOM view_e/);
  assert.match(emptyOpeningGuard(scene, 4), /NO glass|blank plaster/);
});

test("empty view uses camera clay as IMAGE_0 then plan", () => {
  assert.deepEqual(viewRefOrder("plan", "clay", true), ["clay", "plan"]);
  assert.deepEqual(viewRefOrder("plan", "clay", false), ["clay", "plan"]);
  assert.deepEqual(viewRefOrder("plan", "clay", false, true), ["clay", "plan"]);
  assert.deepEqual(viewRefOrder("plan", "clay", false, false, ["west", "east"]), ["clay", "west", "east"]);
  assert.deepEqual(viewRefOrder("plan", "clay", false, false, ["west", "east"], "pano"), ["pano", "west", "east"]);
  assert.deepEqual(viewRefOrder("plan", "clay", false, false, [], "pano"), ["pano", "clay", "plan"]);
  const prompt = skinPrompt({ scene: empty(), camId: 3, manifest: [], place: "日", style: "photoreal" });
  assert.match(prompt, /IMAGE_0 is eye-level clay looking WEST/);
  assert.match(prompt, /HIGHEST WEIGHT/);
  assert.match(prompt, /IMAGE_1 is the zenith/);
  assert.doesNotMatch(prompt, /Stand at the TOP of IMAGE_0/);
  assert.match(prompt, /unfurnished/i);
  const wrap = skinPrompt({ scene: empty(), camId: 1, manifest: [], place: "日", style: "photoreal", wrapRef: true });
  assert.match(wrap, /360 EMPTY PANORAMA/);
  assert.match(wrap, /standing INSIDE that wrap/);
});

test("south sofa north view locks sofa on far wall and uses plan then clay", () => {
  const s = emptyRoomWithSouthSofa();
  const n = expectedViewRules(s, 1);
  assert.equal(n.openingsOnly, false);
  assert.deepEqual(n.farFurniture, ["sofa"]);
  const prompt = skinPrompt({ scene: s, camId: 1, manifest: [], place: "日", style: "photoreal" });
  assert.match(prompt, /IMAGE_0 is eye-level clay looking SOUTH/);
  assert.match(prompt, /IMAGE_1 is the zenith/);
  assert.match(prompt, /sofa/);
  const ns = skinPrompt({ scene: s, camId: 1, manifest: [], place: "日", style: "photoreal", sideRefCount: 2 });
  assert.match(ns, /IMAGE_1 is the WEST photoreal still/);
  assert.match(ns, /IMAGE_2 is the EAST photoreal still/);
});

test("south sofa correct still persists", () => {
  const qa = judgeViewQa(expectedViewRules(emptyRoomWithSouthSofa(), 1), {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door"], left: [], right: ["window"] },
    furniture: ["sofa"],
    farFurniture: ["sofa"],
    extra: [],
  });
  assert.equal(qa.pass, true);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), true);
});

test("south sofa invented far window never persists", () => {
  const qa = judgeViewQa(expectedViewRules(emptyRoomWithSouthSofa(), 1), {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: true,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door", "glass"], left: [], right: ["window"] },
    furniture: ["sofa"],
    farFurniture: ["sofa"],
    extra: [],
  });
  assert.equal(qa.pass, false);
  assert.ok(qa.errors.some((e) => /invented-far/i.test(e)));
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), false);
});

test("qa schema is fail-closed if the model copies it", async () => {
  const ai = await readFile(new URL("../public/studio/scene-spec.mjs", import.meta.url), "utf8");
  assert.match(ai, /schema-only/);
  assert.match(ai, /uncertain":true/);
  assert.doesNotMatch(ai, /"pass":true,"people":false,"uncertain":false,"farWall":"south"/);
  assert.match(ai, /CENTER of the photo/);
});

test("center table is free-standing, openings unchanged, no sofa", () => {
  const s = emptyRoomWithCenterTable();
  assert.deepEqual(
    s.objects.map((o) => `${o.id}:${o.wall ?? "free"}`).sort(),
    ["door-s:south", "table-c:free", "window-w:west"],
  );
  const n = expectedViewRules(s, 1);
  assert.equal(n.openingsOnly, false);
  assert.ok(n.mustHave.includes("table"));
  const prompt = skinPrompt({ scene: s, camId: 1, manifest: [], place: "日", style: "photoreal" });
  assert.match(prompt, /FLOOR FURNITURE/);
  assert.match(prompt, /Empty-room unfurnished mode is OFF/);
  const retry = skinPrompt({ scene: s, camId: 1, manifest: [], place: "日", style: "photoreal", strictRetry: true, mismatch: ["missing:table"] });
  assert.doesNotMatch(retry, /\bVacant\b/);
  const qa = judgeViewQa(n, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    tableVisible: true,
    openings: { far: ["door"], left: [], right: ["window"] },
    furniture: ["table"],
    extra: [],
  });
  assert.equal(qa.pass, true);
});

test("QA furniture objects still count as table", () => {
  const n = expectedViewRules(emptyRoomWithCenterTable(), 1);
  const qa = judgeViewQa(n, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "south",
    leftWall: "east",
    rightWall: "west",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: true,
    openings: { far: ["door"], left: [], right: ["window"] },
    furniture: [{ type: "table" }],
    extra: [{}, "[object Object]"],
  });
  assert.equal(qa.pass, true, qa.errors.join("; "));
});

test("view_w prompt locks east far wall and west window behind", () => {
  const s = emptyRoomWithCenterTable();
  const w = expectedViewRules(s, 2);
  assert.equal(w.farWall, "east");
  assert.deepEqual(w.farOpenings, []);
  assert.deepEqual(w.rightOpenings, ["door"]);
  assert.ok(w.mustNotSee.includes("window"));
  const prompt = skinPrompt({ scene: s, camId: 2, manifest: [], place: "日", style: "photoreal" });
  assert.match(prompt, /FAR wall is EAST/);
  assert.match(prompt, /BEHIND your back/);
  assert.match(prompt, /IMAGE_0 is eye-level clay/);
  assert.match(prompt, /IMAGE_1 is the zenith/);
});

test("view_w remote extra note does not reject; invented far window does", () => {
  const s = emptyRoomWithCenterTable();
  const w = expectedViewRules(s, 2);
  const base = {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "east",
    leftWall: "north",
    rightWall: "south",
    farHasDoor: false,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: true,
    rightHasWindow: false,
    tableVisible: true,
    openings: { far: [], left: [], right: ["door"] },
    furniture: ["table"],
    farFurniture: [],
  };
  const ok = judgeViewQa(w, { ...base, extra: ["remote extra"], errors: ["remote extra"], furniture: ["table", "plant"] });
  assert.equal(ok.pass, true, ok.errors.join("; "));
  const bad = judgeViewQa(w, { ...base, farHasWindow: true, openings: { far: ["window"], left: [], right: ["door"] } });
  assert.equal(bad.pass, false);
  assert.ok(bad.errors.some((e) => /invented-far/i.test(e)));
});

test("compass phrases like north wall still match", () => {
  const cam = expectedViewRules(emptyRoomWithCenterTable(), 4);
  const qa = judgeViewQa(cam, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "north wall",
    leftWall: "west wall",
    rightWall: "east plaster",
    farHasDoor: false,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: true,
    rightHasDoor: false,
    rightHasWindow: false,
    tableVisible: true,
    openings: { far: [], left: ["window"], right: [] },
    furniture: ["table"],
    extra: ["remote extra"],
  });
  assert.equal(qa.pass, true, qa.errors.join("; "));
});

test("furniture QA fail-closed on unlabeled/uncertain walls", () => {
  const cam = expectedViewRules(emptyRoomWithCenterTable(), 4);
  const qa = judgeViewQa(cam, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "???",
    leftWall: "",
    rightWall: "unknown",
    farHasDoor: false,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: true,
    rightHasDoor: false,
    rightHasWindow: false,
    tableVisible: true,
    openings: { far: [], left: ["window"], right: [] },
    furniture: ["table"],
  });
  assert.equal(qa.pass, false);
  assert.ok(qa.errors.some((e) => /wall-uncertain|far-wall missing|left-wall missing/.test(e)));
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), false);
});

test("wrong-wall furniture or extra opening never persist", () => {
  const sofa = emptyRoomWithSouthSofa();
  const west = expectedViewRules(sofa, 2);
  const qa = judgeViewQa(west, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "east",
    leftWall: "north",
    rightWall: "south",
    farHasDoor: false,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: false,
    openings: { far: [], left: [], right: [] },
    furniture: ["sofa"],
    farFurniture: ["sofa"],
  });
  assert.equal(qa.pass, false);
  assert.ok(qa.errors.some((e) => /wrong-wall|invented/.test(e) || /missing/.test(e)));
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", qa), false);
  const extraDoor = judgeViewQa(west, {
    pass: true,
    people: false,
    uncertain: false,
    farWall: "east",
    leftWall: "north",
    rightWall: "south",
    farHasDoor: true,
    farHasWindow: false,
    leftHasDoor: false,
    leftHasWindow: false,
    rightHasDoor: false,
    rightHasWindow: false,
    openings: { far: ["door"], left: [], right: [] },
    furniture: ["sofa"],
    farFurniture: [],
  });
  assert.equal(extraDoor.pass, false);
  assert.equal(shouldPersistViewStill("data:image/jpeg;base64,xx", extraDoor), false);
});
