// ../tmp/fenjing-src/src/lib/scene-spec.ts
var KIND_TO_CAM = {
  view_n: 1,
  view_w: 2,
  view_e: 3,
  view_s: 4
};
var CAM_TO_KIND = {
  1: "view_n",
  2: "view_w",
  3: "view_e",
  4: "view_s"
};
var CAMERA_WALL_MAP = {
  1: { left: "east", far: "south", center: "south", right: "west", behind: "north" },
  2: { left: "north", far: "east", center: "east", right: "south", behind: "west" },
  3: { left: "south", far: "west", center: "west", right: "north", behind: "east" },
  4: { left: "west", far: "north", center: "north", right: "east", behind: "south" }
};
function camerasForRoom(room) {
  const mx = room.width / 2 + 1.2;
  const mz = room.depth / 2 + 1.2;
  const y = 1.6;
  const t = { x: 0, y: 1.2, z: 0 };
  return {
    1: { position: { x: 0, y, z: mz }, target: t, locked: true },
    2: { position: { x: -mx, y, z: 0 }, target: t, locked: true },
    3: { position: { x: mx, y, z: 0 }, target: t, locked: true },
    4: { position: { x: 0, y, z: -mz }, target: t, locked: true }
  };
}
function v(x, y, z) {
  return { x, y, z };
}
function add(a, b) {
  return v(a.x + b.x, a.y + b.y, a.z + b.z);
}
function subtract(a, b) {
  return v(a.x - b.x, a.y - b.y, a.z - b.z);
}
function scale(a, s) {
  return v(a.x * s, a.y * s, a.z * s);
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}
function normalize(a) {
  const n = length(a) || 1;
  return scale(a, 1 / n);
}
function rotateY(p, deg) {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return v(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}
function worldPosition(obj, byId) {
  if (!obj.parentId) return obj.position;
  const parent = byId.get(obj.parentId);
  if (!parent) return obj.position;
  const local = obj.localPosition ?? obj.position;
  return add(worldPosition(parent, byId), rotateY(local, parent.rotationY));
}
function worldToCamera(point, camera) {
  const forward = normalize(subtract(camera.target, camera.position));
  const worldUp = v(0, 1, 0);
  let right = cross(worldUp, forward);
  if (length(right) < 1e-6) right = v(1, 0, 0);
  else right = normalize(right);
  const up = normalize(cross(forward, right));
  const relative = subtract(point, camera.position);
  return {
    horizontal: dot(relative, right),
    vertical: dot(relative, up),
    depth: dot(relative, forward)
  };
}
function getVisibleObjects(scene, camId, threshold = 0.55) {
  const cam = scene.cameras[camId];
  const walls = CAMERA_WALL_MAP[camId];
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  const out = [];
  for (const obj of scene.objects) {
    if (isPersonObject(obj)) continue;
    if (obj.wall && obj.wall === walls.behind) continue;
    const world = worldPosition(obj, byId);
    const camP = worldToCamera(world, cam);
    if (camP.depth <= 0.12) continue;
    const zone = camP.horizontal < -threshold ? "left" : camP.horizontal > threshold ? "right" : "center";
    out.push({ obj, world, cam: camP, zone });
  }
  return out.sort((a, b) => a.cam.depth - b.cam.depth);
}
function cameraManifest(scene, camId) {
  const walls = CAMERA_WALL_MAP[camId];
  const visible = getVisibleObjects(scene, camId);
  const byZone = { left: [], center: [], right: [] };
  for (const h of visible) byZone[h.zone].push(`${h.obj.type}:${h.obj.id}`);
  const forbidden = scene.objects.filter((o) => o.wall === walls.behind).map((o) => `${o.type}:${o.id}`);
  return {
    cameraId: camId,
    walls,
    expected: byZone,
    forbidden,
    visibleIds: visible.map((h) => h.obj.id)
  };
}
function emptySceneSpec(place = "set") {
  const room = { width: 6.4, depth: 5, height: 2.8 };
  return { room, objects: [{ id: "origin", type: place || "floor", position: v(0, 0, 0), size: v(1, 0.05, 1), rotationY: 0 }], cameras: camerasForRoom(room) };
}
function emptyOpeningsScene() {
  const room = { width: 6.4, depth: 6.4, height: 2.8 };
  return {
    room,
    cameras: camerasForRoom(room),
    objects: [
      { id: "door-s", type: "door", position: v(0, 0, -3.2), size: v(1.1, 2.1, 0.16), rotationY: 0, wall: "south" },
      { id: "window-w", type: "window", position: v(-3.2, 1.1, 0), size: v(0.16, 1.6, 2.2), rotationY: 0, wall: "west" }
    ]
  };
}
function emptyRoomWithCenterTable() {
  const scene = emptyOpeningsScene();
  scene.objects.push({
    id: "table-c",
    type: "table",
    position: v(0, 0, 0),
    size: v(1.4, 0.75, 0.9),
    rotationY: 0
  });
  return scene;
}
function emptyRoomWithTableAndSofa() {
  const scene = emptyRoomWithCenterTable();
  scene.objects.push({
    id: "sofa-s",
    type: "sofa",
    position: v(0, 0, -2.5),
    size: v(2.8, 0.8, 0.9),
    rotationY: 0,
    wall: "south"
  });
  return scene;
}
function emptyRoomWithSouthSofa() {
  const scene = emptyOpeningsScene();
  scene.objects.push({
    id: "sofa-s",
    type: "sofa",
    position: v(0, 0, -2.5),
    size: v(2.8, 0.8, 0.9),
    rotationY: 0,
    wall: "south"
  });
  return scene;
}
function layoutFromText(name = "", heading = "", description = "") {
  const text = `${heading} ${name} ${description}`;
  if (/空房间|开口测试|empty.?room|openings.?test/i.test(text)) {
    return /桌|table/i.test(text) ? emptyRoomWithCenterTable() : /沙发|sofa/i.test(text) ? emptyRoomWithSouthSofa() : emptyOpeningsScene();
  }
  if (/夜总会|包间|钢管|舞台|夜店|酒吧/i.test(text)) {
    const room2 = { width: 6.4, depth: 6.4, height: 2.8 };
    const objects2 = [
      { id: "sofa-n", type: "sofa", position: v(0, 0, 2.55), size: v(3.6, 0.8, 0.9), rotationY: 0, wall: "north" },
      { id: "sofa-s", type: "sofa", position: v(0, 0, -2.5), size: v(3.4, 0.8, 1), rotationY: 0, wall: "south" },
      { id: "table-n", type: "table", position: v(0, 0, 1.65), size: v(1.5, 0.4, 0.7), rotationY: 0 },
      { id: "table-s", type: "table", position: v(0, 0, -1.5), size: v(1.5, 0.4, 0.7), rotationY: 0 },
      { id: "bar-w", type: "counter", position: v(-2.55, 0, 1.75), size: v(0.7, 1.1, 1.8), rotationY: 0, wall: "west" },
      { id: "cabinet-e", type: "cabinet", position: v(2.95, 0, 1.85), size: v(0.4, 1.8, 1.2), rotationY: 0, wall: "east" },
      { id: "stage-01", type: "platform", position: v(0, 0, 0), size: v(2.2, 0.32, 2.2), rotationY: 0 },
      { id: "pole-01", type: "pole", position: v(0, 0, 0), size: v(0.12, 2.6, 0.12), rotationY: 0 },
      { id: "door-w", type: "door", position: v(-3.2, 0, 0), size: v(0.16, 2.1, 1.2), rotationY: 0, wall: "west" },
      { id: "window-e", type: "window", position: v(3.2, 1.1, 0), size: v(0.16, 1.6, 2.6), rotationY: 0, wall: "east" }
    ];
    return { room: room2, objects: objects2, cameras: camerasForRoom(room2) };
  }
  if (/警局|派出所|接待室|precinct|police.?station|接待大厅/i.test(text)) {
    const room2 = { width: 7.2, depth: 6, height: 3 };
    const objects2 = [
      { id: "cabinet-n", type: "cabinet", position: v(0, 0, 2.7), size: v(2.6, 1.8, 0.42), rotationY: 0, wall: "north" },
      { id: "counter-01", type: "counter", position: v(0, 0, 0.7), size: v(2.2, 1.1, 0.55), rotationY: 0 },
      { id: "bench-s", type: "bench", position: v(1.15, 0, -1.85), size: v(1.8, 0.55, 0.6), rotationY: 0 },
      { id: "door-s", type: "door", position: v(0, 0, -3), size: v(1.5, 2.2, 0.16), rotationY: 0, wall: "south" },
      { id: "door-w", type: "door", position: v(-3.6, 0, 0.35), size: v(0.16, 2.1, 1), rotationY: 0, wall: "west" },
      { id: "window-e", type: "window", position: v(3.6, 1.2, 0), size: v(0.16, 1.5, 2.4), rotationY: 0, wall: "east" }
    ];
    return { room: room2, objects: objects2, cameras: camerasForRoom(room2) };
  }
  const room = { width: 6.4, depth: 6.4, height: 2.8 };
  const objects = [];
  const add2 = (partial) => {
    objects.push({ rotationY: 0, ...partial });
  };
  if (/窗|window/i.test(text)) {
    add2({ id: "window-e", type: "window", position: v(3.2, 1.1, 0), size: v(0.16, 1.6, 2.4), wall: "east" });
  }
  if (/门|door/i.test(text)) {
    add2({ id: "door-w", type: "door", position: v(-3.2, 0, 0), size: v(0.16, 2.1, 1), wall: "west" });
  }
  if (/床|bed/i.test(text)) {
    add2({ id: "bed-01", type: "bed", position: v(-1.2, 0, 0.3), size: v(2, 0.5, 2.1), wall: "west" });
  }
  if (/沙发|sofa/i.test(text)) {
    add2({ id: "sofa-s", type: "sofa", position: v(0.4, 0, -2.4), size: v(2.6, 0.8, 0.9), wall: "south" });
  }
  if (/椅|armchair|chair/i.test(text) && !/轮椅/.test(text)) {
    add2({ id: "chair-01", type: "armchair", position: v(1.8, 0, -1.2), size: v(0.8, 0.8, 0.8) });
  }
  if (/茶几|咖啡桌|coffee/i.test(text)) {
    add2({ id: "table-01", type: "table", position: v(0.3, 0, -1.3), size: v(1.2, 0.4, 0.7) });
  }
  if (/电视|tv|television/i.test(text)) {
    add2({ id: "tv-n", type: "tv", position: v(0.2, 1.1, 3.1), size: v(1.4, 0.8, 0.12), wall: "north" });
  }
  if (/柜|cabinet|wardrobe/i.test(text)) {
    add2({ id: "cabinet-e", type: "cabinet", position: v(2.9, 0, -1.6), size: v(0.45, 1.8, 1.2), wall: "east" });
  }
  if (!objects.length) {
    add2({ id: "sofa-s", type: "sofa", position: v(0, 0, -2.4), size: v(2.8, 0.8, 0.9), wall: "south" });
    add2({ id: "table-01", type: "table", position: v(0, 0, -1.2), size: v(1.1, 0.4, 0.7) });
    add2({ id: "door-w", type: "door", position: v(-3.2, 0, 0.3), size: v(0.16, 2.1, 1), wall: "west" });
    add2({ id: "window-e", type: "window", position: v(3.2, 1.1, 0), size: v(0.16, 1.6, 2.2), wall: "east" });
  }
  if (!objects.some((o) => o.type === "door")) {
    add2({ id: "door-w", type: "door", position: v(-3.2, 0, 0), size: v(0.16, 2.1, 1), wall: "west" });
  }
  return { room, objects, cameras: camerasForRoom(room) };
}
function specInventoryBlock(scene) {
  if (!scene?.objects?.length) return "";
  const buckets = { north: [], south: [], east: [], west: [], center: [] };
  for (const o of scene.objects) {
    if (!o || o.id === "origin" || isPersonObject(o)) continue;
    const side = o.wall && ["north", "south", "east", "west"].includes(o.wall) ? o.wall : "center";
    buckets[side].push(`${o.type}`);
  }
  const line = (side, label) => buckets[side].length ? `${label}: ${buckets[side].join(", ")}.` : `${label}: solid plaster, no extra opening.`;
  return [
    `Room size ${scene.room.width}m east\u2013west \xD7 ${scene.room.depth}m north\u2013south, height ${scene.room.height}m.`,
    "LOCKED INTERIOR FOOTPRINTS (white blocks, same xz in every view):",
    line("north", "NORTH / top of plan"),
    line("west", "WEST / left of plan"),
    line("east", "EAST / right of plan"),
    line("south", "SOUTH / bottom of plan"),
    buckets.center.length ? `CENTER / origin: ${buckets.center.join(", ")}.` : "",
    "This is ONE interior room. Forbidden: house, villa, pool, garden, driveway, pitched roof, neighborhood aerial."
  ].filter(Boolean).join(" ");
}
function num(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function vec3(raw, fallback) {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw;
  return { x: num(o.x, fallback.x), y: num(o.y, fallback.y), z: num(o.z, fallback.z) };
}
var PEOPLE_RE = /\b(persons?|people|humans?|figures?|mannequins?|characters?|actors?|extras?|crowds?|dancers?|bodyguards?|wom[ae]n|men|man|girls?|boys?|npcs?|silhouettes?|guests?|patrons?)\b|人物|人群|人形|人偶|男人|女人|男孩|女孩|保镖|女郎|群众|舞者|宾客|客人|警察|警员|模特/i;
function isPersonObject(obj) {
  return PEOPLE_RE.test(`${obj.type ?? ""} ${obj.id ?? ""}`);
}
var WALLS = ["north", "south", "west", "east"];
function parseSceneSpec(raw) {
  let v2 = raw;
  if (typeof raw === "string") {
    try {
      v2 = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v2 || typeof v2 !== "object") return null;
  const o = v2;
  if (o.room && Array.isArray(o.objects)) {
    const roomIn = o.room;
    const room = {
      width: Math.max(2, num(roomIn.width, 6.4)),
      depth: Math.max(2, num(roomIn.depth, 5)),
      height: Math.max(2, num(roomIn.height, 2.8))
    };
    const objects = o.objects.map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const r = item;
      const wall = WALLS.includes(String(r.wall)) ? r.wall : null;
      const obj = {
        id: String(r.id || `obj-${i}`),
        type: String(r.type || "prop").slice(0, 40),
        position: vec3(r.position, { x: 0, y: 0, z: 0 }),
        size: vec3(r.size, { x: 0.6, y: 0.6, z: 0.6 }),
        rotationY: num(r.rotationY, 0),
        wall
      };
      if (r.parentId) obj.parentId = String(r.parentId);
      if (r.localPosition) obj.localPosition = vec3(r.localPosition, { x: 0, y: 0, z: 0 });
      if (isPersonObject(obj)) return null;
      return obj;
    }).filter((x) => Boolean(x));
    return { room, objects, cameras: camerasForRoom(room) };
  }
  if (Array.isArray(o.anchors)) {
    const room = { width: 6.4, depth: 5, height: 2.8 };
    const objects = o.anchors.map(
      (a, i) => {
        const wall = WALLS.includes(String(a.side)) ? a.side : null;
        const pos = a.side === "north" ? { x: 0, y: 0, z: 2 } : a.side === "south" ? { x: 0, y: 0, z: -2 } : a.side === "west" ? { x: -2.6, y: 0, z: 0 } : a.side === "east" ? { x: 2.6, y: 0, z: 0 } : { x: 0, y: 0, z: 0 };
        return {
          id: String(a.id || `a${i}`),
          type: String(a.name || "prop").slice(0, 40),
          position: pos,
          size: { x: 0.8, y: 0.9, z: 0.8 },
          rotationY: 0,
          wall
        };
      }
    );
    return { room, objects, cameras: camerasForRoom(room) };
  }
  return null;
}
function lockedPropList(scene, camId) {
  const walls = CAMERA_WALL_MAP[camId];
  return scene.objects.filter((o) => o.id !== "origin" && !isPersonObject(o)).map((o) => {
    const slot = o.wall === walls.behind ? "BEHIND camera \u2014 do not show in this frame" : o.wall === walls.far ? "FAR / image-center (facing wall)" : o.wall === walls.left ? "IMAGE LEFT" : o.wall === walls.right ? "IMAGE RIGHT" : "free-standing in the room (keep it)";
    return `- LOCK ${o.id} (${o.type}) ${slot} world xz=(${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)})`;
  }).join("\n");
}
function alongWall(obj, wall) {
  const t = wall === "north" || wall === "south" ? obj.position.x : obj.position.z;
  if (wall === "north" || wall === "south") {
    if (t < -0.8) return "west-third";
    if (t > 0.8) return "east-third";
    return "center";
  }
  if (t > 0.8) return "north-third";
  if (t < -0.8) return "south-third";
  return "center";
}
function floorSit(obj) {
  const x = obj.position.x;
  const z = obj.position.z;
  const ew = Math.abs(x) < 0.6 ? "on the center aisle" : x > 0 ? "east of aisle" : "west of aisle";
  const ns = Math.abs(z) < 0.6 ? "at room center" : z > 0 ? "north of center" : "south of center";
  return `sits on the floor, ${ew}, ${ns}`;
}
function toPlanItem(obj, wall) {
  return {
    id: obj.id,
    type: obj.type,
    xz: [Number(obj.position.x.toFixed(2)), Number(obj.position.z.toFixed(2))],
    along: wall ? alongWall(obj, wall) : "floor"
  };
}
function parsePlanInventory(scene, camId) {
  const roles = CAMERA_WALL_MAP[camId];
  const walls = ["north", "south", "east", "west"].reduce((acc, wall) => {
    const items = scene.objects.filter((o) => o.wall === wall && o.id !== "origin" && !isPersonObject(o));
    acc[wall] = {
      wall,
      cameraRole: wall === roles.far ? "far" : wall === roles.left ? "left" : wall === roles.right ? "right" : "behind",
      doors: items.filter((o) => /door/i.test(o.type)).map((o) => toPlanItem(o, wall)),
      windows: items.filter((o) => /window|glass|gap|opening/i.test(o.type) && !/door/i.test(o.type)).map((o) => toPlanItem(o, wall)),
      furniture: items.filter((o) => !/door|window|glass|gap|opening/i.test(o.type)).map((o) => toPlanItem(o, wall))
    };
    return acc;
  }, {});
  const floor = scene.objects.filter((o) => !o.wall && o.id !== "origin" && !isPersonObject(o) && !/door|window/i.test(o.type)).map((o) => ({ ...toPlanItem(o), sits: floorSit(o) }));
  return { room: scene.room, walls, floor };
}
function fmtItems(items, none = "none") {
  if (!items.length) return none;
  return items.map((o) => `${o.id}/${o.type} ${o.along} xz=(${o.xz[0].toFixed(1)},${o.xz[1].toFixed(1)})`).join("; ");
}
function planInventoryBlock(scene, camId) {
  const inv = parsePlanInventory(scene, camId);
  const roleLabel = (role) => role === "far" ? "FAR facing" : role === "left" ? "IMAGE LEFT" : role === "right" ? "IMAGE RIGHT" : "BEHIND camera";
  const listed = ["north", "south", "east", "west"].map((w) => {
    const wall = inv.walls[w];
    const openingBits = [
      wall.doors.length ? `door=${fmtItems(wall.doors)}` : "door=none",
      wall.windows.length ? `window=${fmtItems(wall.windows)}` : "window=none"
    ].join("; ");
    const furn = wall.furniture.length ? fmtItems(wall.furniture) : "none";
    return `${w.toUpperCase()} (${roleLabel(wall.cameraRole)}): ${openingBits}; furniture=${furn}`;
  });
  const floor = inv.floor.length ? `FLOOR (furniture sits on the floor, not glued to a wall): ${inv.floor.map((o) => `${o.id}/${o.type} ${o.sits} xz=(${o.xz[0].toFixed(1)},${o.xz[1].toFixed(1)})`).join("; ")}` : "FLOOR: none \u2014 no free-standing furniture";
  return [
    "PLAN JSON WALL MAP / PLAN INVENTORY. Whole zenith plan parsed once. World: +Z=NORTH, -Z=SOUTH, +X=EAST, -X=WEST.",
    `ROOM ${inv.room.width.toFixed(1)}w x ${inv.room.depth.toFixed(1)}d x ${inv.room.height.toFixed(1)}h.`,
    ...listed,
    floor,
    "Every wall lists its doors, windows, and wall furniture. Floor pieces keep those xz in every camera. Do not add an opening or furniture type that is not listed. Do not copy BEHIND-wall doors/windows onto the FAR wall."
  ].join("\n");
}
function planWallMap(scene, camId) {
  return planInventoryBlock(scene, camId);
}
function camDepthHint(xz, camId) {
  const towardFar = camId === 1 ? -xz[1] : camId === 2 ? xz[0] : camId === 3 ? -xz[0] : xz[1];
  if (towardFar > 0.6) return "toward FAR wall";
  if (towardFar < -0.6) return "near camera / foreground";
  return "mid-room";
}
function wallAllowLine(wall) {
  const allow = [];
  if (wall.doors.length) allow.push(`door=${fmtItems(wall.doors)}`);
  if (wall.windows.length) allow.push(`window=${fmtItems(wall.windows)}`);
  if (wall.furniture.length) allow.push(`furniture=${fmtItems(wall.furniture)}`);
  const forbid = [];
  if (!wall.doors.length) forbid.push("door");
  if (!wall.windows.length) forbid.push("window", "glass", "curtain-wall");
  if (!allow.length) {
    return `ALLOW nothing \u2014 SOLID plaster. FORBIDDEN: door, window, glass, extra opening.`;
  }
  return `ALLOW only ${allow.join(" + ")}. FORBIDDEN on this wall: ${forbid.join(", ") || "any extra opening not listed"}.`;
}
function cameraWallLock(scene, camId) {
  const inv = parsePlanInventory(scene, camId);
  const look = camId === 1 ? "SOUTH" : camId === 2 ? "EAST" : camId === 3 ? "WEST" : "NORTH";
  const byRole = (role) => ["north", "south", "east", "west"].map((w) => inv.walls[w]).find((w) => w.cameraRole === role);
  const far = byRole("far");
  const left = byRole("left");
  const right = byRole("right");
  const back = byRole("behind");
  const floor = inv.floor.length ? inv.floor.map((o) => `${o.type} ${o.sits}, ${camDepthHint(o.xz, camId)} xz=(${o.xz[0].toFixed(1)},${o.xz[1].toFixed(1)})`).join("; ") : "none";
  const backOpen = [...back.doors, ...back.windows].map((o) => o.type).join(" and ") || "no opening";
  return [
    `THIS CAMERA LOCK ${CAM_TO_KIND[camId]} / cam ${camId}. Look ${look}. Do not rotate the room.`,
    `FAR wall is ${far.wall.toUpperCase()}. LEFT wall is ${left.wall.toUpperCase()}. RIGHT wall is ${right.wall.toUpperCase()}. BACK wall is ${back.wall.toUpperCase()} (BEHIND your back, not in frame).`,
    `FAR (image center) = ${far.wall.toUpperCase()} wall. ${wallAllowLine(far)}`,
    `LEFT = ${left.wall.toUpperCase()} wall. ${wallAllowLine(left)}`,
    `RIGHT = ${right.wall.toUpperCase()} wall. ${wallAllowLine(right)}`,
    `BACK = ${back.wall.toUpperCase()} wall \u2014 BEHIND the camera, NOT in this photo. Owns ${backOpen}${back.furniture.length ? ` and ${back.furniture.map((o) => o.type).join(", ")}` : ""}. FORBIDDEN: copy BACK openings or furniture onto FAR, LEFT, or RIGHT.`,
    `FLOOR vs this camera: ${floor}. Floor pieces stay on the floor; they are not wall openings.`,
    "HARD RULE: an opening or wall-furniture item may appear ONLY on the wall that owns it in THIS CAMERA LOCK. If a wall says SOLID plaster, do not invent a door or window there. Do not add a second door/window on a wall that already lists its one opening."
  ].join("\n");
}
function viewNSouthFarGuard(scene) {
  const south = scene.objects.filter((o) => o.wall === "south" && o.id !== "origin" && !isPersonObject(o));
  const southDoor = south.filter((o) => /door/i.test(o.type));
  const southSoft = south.filter((o) => /sofa|couch|table|console|desk|ottoman|bench|gap|opening|开口|边桌/i.test(o.type));
  const names = south.length ? south.map((o) => `${o.type} at x=${o.position.x.toFixed(1)}`).join(", ") : "blank plaster, no opening";
  const bits = [
    "view_n FAR wall MUST be plan SOUTH. Do not rotate the room. Do not put North furniture on the facing wall.",
    `SOUTH (facing) from plan JSON: ${names}.`
  ];
  if (!southDoor.length) {
    bits.push(
      "SOUTH has NO door in the plan. FORBIDDEN: inventing a centered wooden door, paneled entry, hall door, or front door on the far wall. If SOUTH is a sofa, side table, or listed opening/gap, show exactly that \u2014 never a made-up wooden door in the middle."
    );
  } else {
    bits.push(
      `SOUTH door only at x=${southDoor.map((d) => d.position.x.toFixed(1)).join(",")}. Do not add a second centered wooden door.`
    );
  }
  if (southSoft.length) {
    bits.push(`Keep SOUTH ${southSoft.map((o) => o.type).join(", ")} as the facing-wall set. They are not a door.`);
  }
  return bits.join(" ");
}
function behindOpeningGuard(scene, camId) {
  const inv = parsePlanInventory(scene, camId);
  const back = ["north", "south", "east", "west"].map((w) => inv.walls[w]).find((w) => w.cameraRole === "behind");
  const far = ["north", "south", "east", "west"].map((w) => inv.walls[w]).find((w) => w.cameraRole === "far");
  if (!back || !far) return "";
  const backOpen = [...back.doors, ...back.windows];
  if (!backOpen.length) return "";
  const names = backOpen.map((o) => o.type).join(" and ");
  const farSolid = !far.doors.length && !far.windows.length;
  return `BACK ${back.wall.toUpperCase()} ${names} is behind this camera \u2014 not in frame. Do not copy it onto FAR ${far.wall.toUpperCase()}${farSolid ? " which is SOLID plaster (ZERO window, ZERO door, ZERO glass)" : ` which only allows ${[...far.doors, ...far.windows].map((o) => o.type).join(" and ")}`}.`;
}
function emptyOpeningGuard(scene, camId) {
  const rules = expectedViewRules(scene, camId);
  if (!rules.openingsOnly) return "";
  const slot = (wall, openings, role) => {
    const items = scene.objects.filter((o) => o.wall === wall && o.id !== "origin" && !isPersonObject(o));
    if (!items.length) return `${role}=${wall.toUpperCase()} blank plaster \u2014 NO door, NO window, NO glass, no new opening`;
    return `${role}=${wall.toUpperCase()} ${items.map((o) => `${o.type} at xz=(${o.position.x.toFixed(1)},${o.position.z.toFixed(1)})`).join(" + ")} only`;
  };
  return [
    `EMPTY ROOM ${rules.kind}. ZERO furniture, ZERO props, ZERO decor, ZERO extra glass.`,
    slot(rules.farWall, rules.farOpenings, "FAR"),
    slot(rules.leftWall, rules.leftOpenings, "LEFT"),
    slot(rules.rightWall, rules.rightOpenings, "RIGHT"),
    `Behind ${rules.behindWall} is not in frame. Do not invent openings.`
  ].join(" ");
}
function weContinuityBlock(camId) {
  if (camId === 1) {
    return "view_n. Stand at the TOP of IMAGE_0 (NORTH). Look SOUTH through the origin. FAR wall = SOUTH = BOTTOM of IMAGE_0. LEFT = EAST (right of plan). RIGHT = WEST (left of plan). Behind camera = NORTH, do not show it as the facing wall.";
  }
  if (camId === 2) {
    return "view_w. Stand at the LEFT of IMAGE_0 (WEST). Look EAST. FAR wall = EAST = RIGHT of IMAGE_0. LEFT = NORTH (top). RIGHT = SOUTH (bottom). Behind = WEST.";
  }
  if (camId === 3) {
    return "view_e. Stand at the RIGHT of IMAGE_0 (EAST). Look WEST. FAR wall = WEST = LEFT of IMAGE_0. LEFT = SOUTH (bottom). RIGHT = NORTH (top). Behind = EAST.";
  }
  return "view_s. Stand at the BOTTOM of IMAGE_0 (SOUTH). Look NORTH. FAR wall = NORTH = TOP of IMAGE_0. LEFT = WEST (left). RIGHT = EAST (right). Behind = SOUTH.";
}
function clayViewBlock(scene, camId) {
  const rules = expectedViewRules(scene, camId);
  const look = camId === 1 ? "SOUTH" : camId === 2 ? "EAST" : camId === 3 ? "WEST" : "NORTH";
  const slot = (wall, openings, role) => {
    const items = scene.objects.filter((o) => o.wall === wall && o.id !== "origin" && !isPersonObject(o));
    if (!openings.length && !items.length) {
      return `${role} ${wall.toUpperCase()} = solid plaster \u2014 no door, no window, no glass`;
    }
    return `${role} ${wall.toUpperCase()} = ${items.map((o) => `${o.type} at xz=(${o.position.x.toFixed(1)},${o.position.z.toFixed(1)})`).join(" + ")}`;
  };
  return [
    `IMAGE_0 is eye-level clay looking ${look}. Skin this massing. Do not move a block.`,
    slot(rules.farWall, rules.farOpenings, "FAR/center"),
    slot(rules.leftWall, rules.leftOpenings, "LEFT"),
    slot(rules.rightWall, rules.rightOpenings, "RIGHT"),
    `Behind ${rules.behindWall} is not in this photo. IMAGE_1 is the zenith plan for wall names only. Do not invent openings.`
  ].join(" ");
}
function furnitureClayBlock(scene, camId) {
  const rules = expectedViewRules(scene, camId);
  if (rules.openingsOnly) return "";
  const look = camId === 1 ? "SOUTH" : camId === 2 ? "EAST" : camId === 3 ? "WEST" : "NORTH";
  const slot = (wall, role) => {
    const items = scene.objects.filter((o) => o.wall === wall && o.id !== "origin" && !isPersonObject(o));
    if (!items.length) return `${role} ${wall.toUpperCase()} = solid plaster \u2014 no extra door or window`;
    return `${role} ${wall.toUpperCase()} = ${items.map((o) => `${o.type} xz=(${o.position.x.toFixed(1)},${o.position.z.toFixed(1)})`).join(" + ")}`;
  };
  const lock = scene.objects.filter((o) => o.id !== "origin" && !isPersonObject(o)).map((o) => `${o.id}/${o.type} wall=${o.wall ?? "free"} xz=(${o.position.x.toFixed(1)},${o.position.z.toFixed(1)})`).join("; ");
  const inv = parsePlanInventory(scene, camId);
  const freeTxt = inv.floor.length ? `FLOOR FURNITURE (must stay sitting at these xz in THIS camera): ${inv.floor.map((o) => `${o.type} ${o.sits} xz=(${o.xz[0].toFixed(1)},${o.xz[1].toFixed(1)})`).join("; ")}. Empty-room unfurnished mode is OFF. Do not strip floor furniture. Do not replace a counter with a sofa.` : "";
  return [
    `IMAGE_0 is eye-level clay looking ${look}. Keep every furniture block.`,
    slot(rules.farWall, "FAR/center"),
    slot(rules.leftWall, "LEFT"),
    slot(rules.rightWall, "RIGHT"),
    `ALL PLAN OBJECTS (same world coords in every view): ${lock}.`,
    freeTxt
  ].filter(Boolean).join(" ");
}
function viewRefOrder(plan, clay, openingsOnly, hidePlan = false, sideStills = [], pano = "") {
  const sides = sideStills.filter(Boolean).slice(0, 2);
  if (pano) {
    if (sides.length >= 2) return [pano, sides[0], sides[1]];
    if (sides.length === 1) return [pano, clay, sides[0]];
    return [pano, clay, plan].filter(Boolean).slice(0, 3);
  }
  if (sides.length >= 2) return [clay, sides[0], sides[1]];
  if (sides.length === 1) return [clay, plan, sides[0]];
  return [clay, plan];
}
var VIEW_QA_FAIL = "\u673A\u4F4D\u548C\u4FEF\u89C6\u767D\u819C\u5BF9\u4E0D\u4E0A\uFF0C\u672A\u4FDD\u5B58";
function shouldPersistViewStill(image, qa) {
  if (!image) return false;
  if (!qa || qa.pass !== true) return false;
  return true;
}
function isOpeningType(type) {
  return /door|window|gap|opening/i.test(type);
}
function typesOnWall(scene, wall) {
  return scene.objects.filter((o) => o.wall === wall && o.id !== "origin" && !isPersonObject(o)).map((o) => o.type);
}
function uniq(list) {
  return [...new Set(list.map((t) => t.toLowerCase()))];
}
function expectedViewRules(scene, camId) {
  const walls = CAMERA_WALL_MAP[camId];
  const typesOn = (wall) => typesOnWall(scene, wall);
  const inventory = scene.objects.filter((o) => o.id !== "origin" && !isPersonObject(o)).map((o) => o.type);
  const far = typesOn(walls.far);
  const behind = typesOn(walls.behind);
  const elsewhere = uniq(
    scene.objects.filter((o) => o.id !== "origin" && !isPersonObject(o) && o.wall !== walls.behind).map((o) => o.type)
  );
  const behindOnly = uniq(behind).filter((t) => !elsewhere.includes(t));
  const farOpenings = uniq(far.filter(isOpeningType));
  const farFurniture = uniq(far.filter((t) => !isOpeningType(t)));
  const leftFurniture = uniq(typesOn(walls.left).filter((t) => !isOpeningType(t)));
  const rightFurniture = uniq(typesOn(walls.right).filter((t) => !isOpeningType(t)));
  const leftOpenings = uniq(typesOn(walls.left).filter(isOpeningType));
  const rightOpenings = uniq(typesOn(walls.right).filter(isOpeningType));
  const freeFurniture = uniq(
    scene.objects.filter((o) => !o.wall && o.id !== "origin" && !isPersonObject(o) && !isOpeningType(o.type)).map((o) => o.type)
  );
  const mustHave = uniq(
    inventory.filter((t) => !behindOnly.includes(t.toLowerCase()) || far.map((x) => x.toLowerCase()).includes(t.toLowerCase()))
  );
  const openingsOnly = inventory.length > 0 && inventory.every((t) => isOpeningType(t));
  const inventorySpec = parsePlanInventory(scene, camId);
  const plan = {
    room: inventorySpec.room,
    camera: { id: camId, far: walls.far, left: walls.left, right: walls.right, behind: walls.behind },
    walls: inventorySpec.walls,
    floor: inventorySpec.floor,
    openings: {
      north: inventorySpec.walls.north.doors.concat(inventorySpec.walls.north.windows).map((o) => o.type),
      south: inventorySpec.walls.south.doors.concat(inventorySpec.walls.south.windows).map((o) => o.type),
      east: inventorySpec.walls.east.doors.concat(inventorySpec.walls.east.windows).map((o) => o.type),
      west: inventorySpec.walls.west.doors.concat(inventorySpec.walls.west.windows).map((o) => o.type)
    },
    furniture: scene.objects.filter((o) => o.id !== "origin" && !isPersonObject(o)).map((o) => ({
      id: o.id,
      type: o.type,
      wall: o.wall ?? null,
      x: o.position.x,
      z: o.position.z,
      sits: o.wall ? void 0 : floorSit(o)
    }))
  };
  return {
    camId,
    kind: CAM_TO_KIND[camId],
    farWall: walls.far,
    leftWall: walls.left,
    rightWall: walls.right,
    behindWall: walls.behind,
    mustSee: uniq(far),
    mustNotSee: uniq(behindOnly),
    inventory: uniq(inventory),
    farOpenings,
    leftOpenings,
    rightOpenings,
    farFurniture,
    leftFurniture,
    rightFurniture,
    freeFurniture,
    mustHave: openingsOnly ? uniq([...farOpenings, ...leftOpenings, ...rightOpenings]) : mustHave,
    openingsOnly,
    planJson: JSON.stringify(plan)
  };
}
function listTypes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    if (typeof x === "string") return x.toLowerCase().trim();
    if (x && typeof x === "object") {
      const o = x;
      const t = o.type ?? o.name ?? o.item ?? o.kind;
      return String(t || "").toLowerCase().trim();
    }
    return "";
  }).filter(Boolean);
}
function openingBag(raw, side) {
  if (!raw || typeof raw !== "object") return [];
  const o = raw;
  return listTypes(o[side] ?? o[side === "far" ? "center" : side]);
}
function hasType(hay, needle) {
  const n = needle.toLowerCase();
  return hay.some((h) => {
    if (h === n || h.includes(n) || n.includes(h)) return true;
    if (n === "table" && /desk|dining|stand/.test(h)) return true;
    if (n === "sofa" && /couch|settee|loveseat|divan/.test(h)) return true;
    if (n === "counter" && /desk|reception|service|bar|table/.test(h)) return true;
    if (n === "bench" && /waiting|seat|pew/.test(h)) return true;
    return false;
  });
}
function openingLike(t) {
  return /door|window|glass|glaz|pane|opening|gap|portal|skylight/i.test(t);
}
function compassWall(raw) {
  const s = raw.trim().toLowerCase();
  if (!s) return "missing";
  const hits = ["north", "south", "east", "west"].filter((w) => new RegExp(`\\b${w}\\b`).test(s));
  if (hits.length === 1) return hits[0];
  if (s === "north" || s === "south" || s === "east" || s === "west") return s;
  return s ? "uncertain" : "missing";
}
function boolish(v2) {
  if (v2 === true || v2 === "true") return true;
  if (v2 === false || v2 === "false") return false;
  return "missing";
}
function judgeViewQa(rules, raw) {
  if (!raw || typeof raw !== "object") return { pass: false, errors: ["qa-unreadable"] };
  const o = raw;
  const errors = [];
  if (o.people !== false) errors.push("people");
  const wallOf = (key) => String(o[key] ?? o[key.replace("Wall", "_wall")] ?? "").trim().toLowerCase();
  const far = compassWall(wallOf("farWall"));
  const left = compassWall(wallOf("leftWall"));
  const right = compassWall(wallOf("rightWall"));
  if (far === "missing") errors.push("far-wall missing");
  else if (far === "uncertain") errors.push("wall-uncertain:far");
  else if (far !== rules.farWall) errors.push(`far-wall ${far}!=${rules.farWall}`);
  if (left === "missing") errors.push("left-wall missing");
  else if (left === "uncertain") errors.push("wall-uncertain:left");
  else if (left !== rules.leftWall) errors.push(`left-wall ${left}!=${rules.leftWall}`);
  if (right === "missing") errors.push("right-wall missing");
  else if (right === "uncertain") errors.push("wall-uncertain:right");
  else if (right !== rules.rightWall) errors.push(`right-wall ${right}!=${rules.rightWall}`);
  const farFurniture = listTypes(o.farFurniture ?? o.far_furniture);
  const furniture = listTypes(o.furniture);
  const farOpen = openingBag(o.openings, "far");
  const leftOpen = openingBag(o.openings, "left");
  const rightOpen = openingBag(o.openings, "right");
  const seen = [...farFurniture, ...furniture, ...farOpen, ...leftOpen, ...rightOpen];
  if (!("openings" in o) && !("furniture" in o) && !farFurniture.length) {
    errors.push("plan-items missing");
  }
  for (const t of rules.farOpenings) {
    if (!hasType(farOpen, t) && !hasType(farFurniture, t)) errors.push(`missing-opening:${t}`);
  }
  const farOpeningLike = [...farOpen, ...farFurniture].filter(openingLike);
  for (const t of farOpeningLike) {
    const isDoor = /door/i.test(t);
    const isWin = /window|glass|glaz|pane|skylight/i.test(t);
    if (isDoor && !rules.farOpenings.some((x) => /door/i.test(x))) errors.push("invented-far-door");
    if (isWin && !rules.farOpenings.some((x) => /window/i.test(x))) errors.push("invented-far-window");
    if (!isDoor && !isWin && !rules.farOpenings.length) errors.push(`invented-far-opening:${t}`);
  }
  if (!rules.farOpenings.length && farOpen.length && !errors.some((e) => e.startsWith("invented-far"))) {
    errors.push("invented-far-opening");
  }
  for (const t of rules.leftOpenings) {
    if (!hasType(leftOpen, t) && !hasType(furniture, t)) errors.push(`missing-left-opening:${t}`);
  }
  for (const t of rules.rightOpenings) {
    if (!hasType(rightOpen, t) && !hasType(furniture, t)) errors.push(`missing-right-opening:${t}`);
  }
  for (const t of rules.farFurniture) {
    if (!hasType(seen, t)) errors.push(`missing-far:${t}`);
  }
  for (const t of rules.freeFurniture) {
    const flagged = t === "table" ? boolish(o.tableVisible) === true : boolish(o[`${t}Visible`]) === true;
    if (!hasType(furniture, t) && !hasType(seen, t) && !flagged) errors.push(`missing-furniture:${t}`);
  }
  for (const t of rules.mustHave) {
    if (rules.freeFurniture.includes(t)) {
      const flagged = t === "table" ? boolish(o.tableVisible) === true : boolish(o[`${t}Visible`]) === true;
      if (hasType(seen, t) || flagged) continue;
      errors.push(`missing:${t}`);
      continue;
    }
    if (!hasType(seen, t)) errors.push(`missing:${t}`);
  }
  const allowed = /* @__PURE__ */ new Set([...rules.inventory, "floor", "wall", "ceiling", "light"]);
  if (!rules.openingsOnly) {
    for (const t of furniture) {
      if (/plant|lamp|clock|art|picture|rug|vase|decor|potted|remote extra/i.test(t)) continue;
      if (rules.inventory.some((a) => /sofa/i.test(a)) && /couch|settee|loveseat/i.test(t)) continue;
      if (rules.inventory.some((a) => /counter/i.test(a)) && /desk|reception|service|table/i.test(t)) continue;
      if (rules.inventory.some((a) => /bench/i.test(a)) && /waiting|pew|seat/i.test(t)) continue;
      if (![...allowed].some((a) => t.includes(a) || a.includes(t))) errors.push(`extra:${t}`);
    }
  }
  for (const t of rules.mustNotSee) {
    if (rules.mustSee.includes(t)) continue;
    if (farFurniture.some((x) => x.includes(t) || t.includes(x))) errors.push(`behind-object-as-far:${t}`);
  }
  if (o.uncertain !== false) errors.push("uncertain");
  const flags = [
    ["farHasDoor", rules.farOpenings, "door"],
    ["farHasWindow", rules.farOpenings, "window"],
    ["leftHasDoor", rules.leftOpenings, "door"],
    ["leftHasWindow", rules.leftOpenings, "window"],
    ["rightHasDoor", rules.rightOpenings, "door"],
    ["rightHasWindow", rules.rightOpenings, "window"]
  ];
  for (const [key, allowedOpen, kind] of flags) {
    const b = boolish(o[key]);
    if (b === "missing") errors.push(`uncertain:${key}`);
    else if (b === true && !allowedOpen.some((x) => x.includes(kind))) errors.push(`invented-${key}`);
    else if (b === false && allowedOpen.some((x) => x.includes(kind))) errors.push(`missing-${key}`);
  }
  for (const t of farFurniture) {
    if (openingLike(t)) continue;
    const onFar = hasType(rules.farFurniture, t);
    const onFree = hasType(rules.freeFurniture, t);
    if (onFar || onFree) continue;
    if (hasType(rules.leftFurniture, t) || hasType(rules.rightFurniture, t) || hasType(rules.mustNotSee, t)) {
      errors.push(`wrong-wall:${t}-on-far`);
    }
  }
  for (const t of leftOpen) {
    if (!rules.leftOpenings.some((r) => hasType([t], r))) errors.push(`invented-left-opening:${t}`);
  }
  for (const t of rightOpen) {
    if (!rules.rightOpenings.some((r) => hasType([t], r))) errors.push(`invented-right-opening:${t}`);
  }
  if (rules.openingsOnly && !("openings" in o)) errors.push("openings-missing");
  if (Array.isArray(o.errors)) {
    for (const e of o.errors) {
      const s = String(e || "").trim();
      if (!s) continue;
      if (s === "schema-only") continue;
      if (rules.openingsOnly && !openingLike(s) && !/people|person|wall/i.test(s)) continue;
      if (!rules.openingsOnly && !/invented-far|people|person|far-window|far-door/i.test(s)) continue;
      errors.push(s);
    }
  }
  if (Array.isArray(o.missing)) {
    for (const e of o.missing) {
      const s = String(e || "").trim();
      if (!s) continue;
      if (rules.openingsOnly && !isOpeningType(s)) continue;
      errors.push(`missing:${s}`);
    }
  }
  if (Array.isArray(o.extra) && o.extra.length) {
    for (const e of o.extra) {
      let s = "";
      if (typeof e === "string") s = e.trim();
      else if (e && typeof e === "object") {
        try {
          s = JSON.stringify(e);
        } catch {
          s = "";
        }
      } else if (e != null) s = String(e);
      if (!s || s === "{}" || s === "[]" || /\[object object\]/i.test(s)) continue;
      if (/remote extra|not in (this )?frame|behind (the )?camera|plant|lamp|clock|decor/i.test(s)) continue;
      if (rules.openingsOnly && !openingLike(s)) continue;
      if (!rules.openingsOnly && rules.inventory.some((a) => s.toLowerCase().includes(a) || a.includes(s.toLowerCase()))) continue;
      if (!rules.openingsOnly && rules.mustNotSee.some((t) => s.toLowerCase().includes(t))) continue;
      errors.push(`extra:${s}`);
    }
  }
  if (o.pass === false && !errors.length) errors.push("model-rejected");
  return { pass: errors.length === 0, errors };
}
function skinPrompt(input) {
  const rules = expectedViewRules(input.scene, input.camId);
  const inventory = rules.inventory;
  const pole = inventory.some((t) => /pole|platform|钢管|舞台/i.test(t));
  const empty = rules.openingsOnly;
  const hidePlan = rules.mustNotSee.some((t) => /door|window/i.test(t));
  const sides = Math.max(0, Math.min(2, input.sideRefCount ?? 0));
  const wrap = Boolean(input.wrapRef);
  const farOpenTxt = rules.farOpenings.length ? `FAR/center wall has ${rules.farOpenings.join(" and ")} only.` : "FAR/center wall is SOLID plaster \u2014 ZERO window, ZERO glass, ZERO curtain wall, ZERO door.";
  const farFurnTxt = rules.farFurniture.length ? `FAR/center furniture from the plan: ${rules.farFurniture.join(", ")}.` : "";
  const weightBlock = wrap ? [
    "IMAGE_0 is the 360 EMPTY PANORAMA of THIS same room \u2014 HIGHEST WEIGHT. You are standing INSIDE that wrap. Yaw-rotate to THIS camera. Do not invent a second room.",
    sides >= 2 ? "IMAGE_1 is the WEST photoreal still. IMAGE_2 is the EAST photoreal still. Materials only. Do not copy their facing walls onto THIS camera FAR wall." : "IMAGE_1 is eye-level clay for THIS camera. IMAGE_2 is the zenith \u767D\u819C for wall assignment. If they conflict, keep the panorama + \u767D\u819C layout.",
    "Far wall of THIS camera is the wall that sits opposite you in the panorama. Reverse coverage is a 180-degree turn in the SAME wrap."
  ].join(" ") : [
    "IMAGE_0 is THIS camera's eye-level WHITE 3D MASSING looking the same way \u2014 HIGHEST WEIGHT. Every white/gray block is furniture that must keep that screen position. Cyan block = window. Dark block = door. Skin materials only: paint, wood, fabric, glass. Do not move, add, or delete a block. Do not invent a second room.",
    sides >= 2 ? "IMAGE_1 is the WEST photoreal still. IMAGE_2 is the EAST photoreal still. Materials only. Do not copy their facing walls onto THIS camera FAR wall." : "IMAGE_1 is the zenith \u767D\u819C PLAN. NORTH=top, WEST=left, EAST=right, SOUTH=bottom. Wall names only. If IMAGE_1 conflicts with IMAGE_0 block positions, keep IMAGE_0.",
    "Do not invent doors or windows that are not blocks in IMAGE_0."
  ].join(" ");
  return [
    wrap ? "Multi-ref edit. IMAGE_0 panorama has the highest weight. Photoreal vacant interior. Do not redesign the room." : "Multi-ref edit. IMAGE_0 camera clay has the highest weight. Photoreal vacant interior. Do not redesign the room.",
    weightBlock,
    empty ? clayViewBlock(input.scene, input.camId) : furnitureClayBlock(input.scene, input.camId),
    planInventoryBlock(input.scene, input.camId),
    cameraWallLock(input.scene, input.camId),
    empty ? "IMAGE_0 sky-blue rectangle = window. Dark rectangle = wooden door. Uniform gray wall = solid plaster with no opening." : `${farOpenTxt} ${farFurnTxt} FAR wall must be ${rules.farWall.toUpperCase()}. LEFT wall ${rules.leftWall}. RIGHT wall ${rules.rightWall}. Do not put ${rules.behindWall} furniture on the facing wall.`,
    empty ? "" : `PLAN JSON: ${rules.planJson}`,
    !empty && input.camId === 1 ? viewNSouthFarGuard(input.scene) : "",
    behindOpeningGuard(input.scene, input.camId),
    emptyOpeningGuard(input.scene, input.camId),
    empty ? "" : lockedPropList(input.scene, input.camId),
    pole ? "Center stage and EXACTLY ONE vertical pole stay in the middle of the room. Do not drop the pole." : "",
    empty ? "" : inventory.length ? `Keep only types listed in PLAN JSON WALL MAP: ${inventory.join(", ")}.` : "",
    !empty && inventory.some((t) => /counter|bench|cabinet/i.test(t)) ? "POLICE PRECINCT RECEPTION / \u8B66\u5C40\u63A5\u5F85\u5BA4. The nearest wide block is a SERVICE COUNTER (high desk), not a sofa. Beyond it a low waiting BENCH. Fluorescent practicals. VACANT \u2014 zero people." : "",
    empty ? "EMPTY unfurnished room. ZERO furniture: no sofa, table, chair, plant, rug, lamp, bed, art. Bare plaster + floor only." : "FURNITURE IS IN THE PLAN. Empty-room unfurnished mode is OFF. Keep every listed furniture block at its world xz. Do not strip the centered table.",
    "Forbidden: people, mannequins, text, 3D axis gizmo, extra doors not listed on that wall in PLAN JSON WALL MAP, furniture types not in the plan.",
    /夜|night/i.test(input.place) ? "Night interior lighting." : "Quiet interior lighting.",
    "Photoreal live-action interior still. Painted walls, real materials. NOT a clay miniature, NOT a 3D white model.",
    input.strictRetry ? [
      wrap ? "STRICT RETRY. IMAGE_0 panorama stays highest weight. Rotate inside that wrap. Do not invent FAR glass or extra doors." : "STRICT RETRY. IMAGE_0 camera clay stays highest weight. Rebuild THIS camera from IMAGE_0 massing. Do not invent FAR glass or extra doors.",
      input.mismatch?.length ? `Fix these mismatches: ${input.mismatch.slice(0, 8).join("; ")}.` : "",
      hidePlan ? "BACK-wall openings stay behind the camera. FAR is not allowed to copy them." : "",
      empty ? "No invented centered wooden door. No extra furniture. No wrong far wall. Vacant." : "Keep plan furniture at its world xz. No vacant empty-room wipe."
    ].filter(Boolean).join(" ") : ""
  ].filter(Boolean).join("\n");
}
export {
  CAMERA_WALL_MAP,
  CAM_TO_KIND,
  KIND_TO_CAM,
  VIEW_QA_FAIL,
  add,
  behindOpeningGuard,
  cameraManifest,
  cameraWallLock,
  camerasForRoom,
  clayViewBlock,
  cross,
  dot,
  emptyOpeningGuard,
  emptyOpeningsScene,
  emptyRoomWithCenterTable,
  emptyRoomWithSouthSofa,
  emptyRoomWithTableAndSofa,
  emptySceneSpec,
  expectedViewRules,
  furnitureClayBlock,
  getVisibleObjects,
  isPersonObject,
  judgeViewQa,
  layoutFromText,
  length,
  lockedPropList,
  normalize,
  parsePlanInventory,
  parseSceneSpec,
  planInventoryBlock,
  planWallMap,
  rotateY,
  scale,
  shouldPersistViewStill,
  skinPrompt,
  specInventoryBlock,
  subtract,
  viewNSouthFarGuard,
  viewRefOrder,
  weContinuityBlock,
  worldPosition,
  worldToCamera
};

export const VIEW_QA_READER_BRIEF = `Inspect THIS photograph. JSON only. The next object is a SCHEMA — copying it fails (uncertain=true).
{"pass":false,"people":false,"uncertain":true,"farWall":"north","leftWall":"west","rightWall":"east","openings":{"far":[],"left":[],"right":[]},"furniture":[],"errors":["schema-only"]}
FAR wall = the wall in the CENTER of the photo (the wall you face). Do not call a paid image API.`;
