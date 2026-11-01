const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function runtime(
  fetch = async () => ({ ok: true, json: async () => ({ id: "ali" }) }),
) {
  const exports = {};
  const timers = new Map();
  let timerID = 0;
  const source = ts.transpileModule(
    fs.readFileSync("src/activities.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    fetch,
    Date,
    Math,
    Set,
    AbortController,
    performance,
    console: { warn() {} },
    setTimeout: (fn, delay) => {
      const id = ++timerID;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return exports;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("90 seconds elapsed and 50 active reconstruct pause/resume, overlay and unique visits", () => {
  const { ActivityInteraction } = runtime();
  let now = 0,
    id = 0;
  const rows = [];
  const visit = new ActivityInteraction(
    "session",
    { type: "place", id: "ground" },
    "event_form",
    "event_creation_started",
    {},
    (row) => rows.push(row),
    () => String(++id),
    () => now,
  );
  now = 30000;
  visit.setState(true, false);
  visit.setState(false, false); // Overlay and background together emit only one pause.
  now = 70000;
  visit.setState(true, true);
  now = 90000;
  visit.record("event_creation_submitted", { attempt_number: 1 });
  assert.deepEqual(
    rows.map((row) => row.action),
    [
      "event_creation_started",
      "interaction_paused",
      "interaction_resumed",
      "event_creation_submitted",
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.details.elapsed_ms),
    [0, 30000, 70000, 90000],
  );
  assert.deepEqual(
    rows.map((row) => row.details.active_ms),
    [0, 30000, 30000, 50000],
  );
  assert.deepEqual(
    rows.map((row) => row.interaction_step),
    [1, 2, 3, 4],
  );
  assert.equal(new Set(rows.map((row) => row.interaction_id)).size, 1);
  visit.close("completed");
  visit.close("dismissed");
  visit.record("join_attempted");
  assert.equal(rows.length, 5, "cleanup cannot duplicate a known close");
  const reopened = new ActivityInteraction(
    "session",
    { type: "place", id: "ground" },
    "event_form",
    "event_creation_started",
    {},
    () => {},
    () => String(++id),
    () => now,
  );
  assert.notEqual(reopened.id, visit.id);
  now += 10000;
  assert.equal(visit.headers("request")["X-Activity-Interaction"], visit.id);
});

test("queue persists original IDs and sessions across restart; acknowledges only sent rows", async () => {
  let saved = { actorID: "ali", entries: [] };
  const requests = [];
  let deliver;
  let block = true;
  const fetch = async (url, options) => {
    if (url.endsWith("/me"))
      return { ok: true, json: async () => ({ id: "ali" }) };
    const body = JSON.parse(options.body);
    requests.push(body);
    if (block)
      await new Promise((resolve) => {
        deliver = resolve;
      });
    return {
      ok: true,
      json: async () => ({
        results: body.activities.map((row) => ({
          id: row.id,
          status: "accepted",
        })),
      }),
    };
  };
  const { ActivityQueue } = runtime(fetch);
  const storage = {
    load: async () => clone(saved),
    save: async (snapshot) => {
      saved = clone(snapshot);
    },
  };
  const row = (id) => ({
    id,
    session_id: "old-session",
    interaction_id: "original-interaction",
    occurred_at: new Date().toISOString(),
  });
  const queue = new ActivityQueue("api", storage);
  queue.record(row("first"));
  await settle();
  assert.equal(saved.entries[0].activity.id, "first");
  // A new process restores the old session/interaction instead of relabeling them.
  const restored = new ActivityQueue("api", storage);
  await settle();
  restored.setActive(true);
  const sending = restored.flush();
  await settle();
  restored.record(row("second"));
  await settle();
  deliver();
  await sending;
  assert.deepEqual(
    saved.entries.map((entry) => entry.activity.id),
    ["second"],
  );
  assert.equal(requests[0].activities[0].session_id, "old-session");
  assert.equal(
    requests[0].activities[0].interaction_id,
    "original-interaction",
  );
  block = false;
  await restored.flush();
  assert.equal(saved.entries.length, 0);
  restored.setActive(false);
});

test("failed delivery retries unchanged IDs, drops invalid siblings and quarantines other actors", async () => {
  const now = new Date().toISOString();
  let saved = {
    actorID: "ali",
    entries: [
      { actorID: "sara", activity: { id: "other", occurred_at: now } },
      { actorID: "ali", activity: { id: "good", occurred_at: now } },
      { actorID: "ali", activity: { id: "invalid", occurred_at: now } },
      {
        actorID: null,
        activity: { id: "unknown-old-process", occurred_at: now },
      },
    ],
  };
  let fail = true;
  const sent = [];
  const { ActivityQueue } = runtime(async (url, options) => {
    if (url.endsWith("/me"))
      return { ok: true, json: async () => ({ id: "ali" }) };
    const body = JSON.parse(options.body);
    sent.push(body.activities.map((row) => row.id));
    if (fail) throw new Error("offline");
    return {
      ok: true,
      json: async () => ({
        results: body.activities.map((row) => ({
          id: row.id === "invalid" ? null : row.id,
          status: row.id === "invalid" ? "rejected" : "accepted",
        })),
      }),
    };
  });
  const queue = new ActivityQueue("api", {
    load: async () => clone(saved),
    save: async (snapshot) => {
      saved = clone(snapshot);
    },
  });
  await settle();
  queue.setActive(true);
  await queue.flush();
  assert.deepEqual(sent[0], ["good", "invalid"]);
  fail = false;
  await queue.flush();
  assert.deepEqual(sent[1], sent[0]);
  assert.deepEqual(
    saved.entries.map((entry) => entry.activity.id),
    ["other"],
  );
  queue.setActive(false);
});

test("retention bounds queued history without dropping newly recorded rows", async () => {
  let saved = {
    actorID: "ali",
    entries: Array.from({ length: 1001 }, (_, index) => ({
      actorID: "ali",
      activity: { id: String(index), occurred_at: new Date().toISOString() },
    })),
  };
  const { ActivityQueue } = runtime();
  const queue = new ActivityQueue("api", {
    load: async () => clone(saved),
    save: async (snapshot) => {
      saved = clone(snapshot);
    },
  });
  queue.record({ id: "new", occurred_at: new Date().toISOString() });
  await settle();
  assert.equal(saved.entries.length, 1000);
  assert.equal(saved.entries.at(-1).activity.id, "new");
});

test("place refreshes preserve one view; overlays use place_details and reopens count separately", () => {
  const { ActivityInteraction } = runtime();
  let nextID = 0,
    now = 0;
  const rows = [];
  const uuid = () => String(++nextID);
  const open = () =>
    new ActivityInteraction(
      "session",
      { type: "place", id: "ground" },
      "explore",
      "place_viewed",
      {},
      (row) => rows.push(row),
      uuid,
      () => now,
    );
  const first = open();
  now = 10000;
  first.setState(false, true);
  now = 20000;
  first.setState(true, true);
  first.close("dismissed");
  const second = open();
  assert.equal(rows.filter((row) => row.action === "place_viewed").length, 2);
  const paused = rows.find((row) => row.action === "interaction_paused");
  const resumed = rows.find((row) => row.action === "interaction_resumed");
  assert.equal(paused.source, "place_details");
  assert.equal(resumed.details.active_ms, paused.details.active_ms);
  assert.notEqual(first.id, second.id);
});

test("chat visits pause in background, close once and reopen with a new interaction", () => {
  const { ActivityInteraction } = runtime();
  const rows = [];
  let now = 0, id = 0;
  const open = () => new ActivityInteraction("session", { type: "event", id: "game" },
    "event_details", "chat_opened", {}, row => rows.push(row), () => String(++id), () => now);
  const first = open();
  const originalHeaders = first.headers("message-receipt");
  now = 10000;
  first.setState(true, false);
  now = 40000;
  first.setState(true, true);
  now = 45000;
  first.close("dismissed");
  first.close("dismissed");
  const second = open();
  assert.notEqual(first.id, second.id);
  assert.deepEqual(rows.map(row => row.action), ["chat_opened", "interaction_paused", "interaction_resumed", "interaction_closed", "chat_opened"]);
  assert.equal(rows[0].source, "event_details");
  for (const row of rows.slice(1, 4)) assert.equal(row.source, "event_chat");
  assert.equal(rows[3].details.active_ms, 15000);
  assert.equal(rows[3].details.elapsed_ms, 45000);
  assert.equal(rows[4].interaction_step, 1);
  // Pending messages retain these headers even if the user reopens before retrying.
  assert.equal(originalHeaders["X-Activity-Interaction"], first.id);
  assert.notEqual(originalHeaders["X-Activity-Interaction"], second.id);
});

test("one session start survives effect replay, backgrounding, delivery retry and process restart", async () => {
  let saved = { actorID: "ali", entries: [] };
  let offline = true;
  const requests = [];
  const fetch = async (url, options) => {
    if (url.endsWith("/me")) return { ok: true, json: async () => ({ id: "ali" }) };
    const body = JSON.parse(options.body);
    requests.push(clone(body));
    if (offline) throw new Error("offline");
    return { ok: true, json: async () => ({ results: body.activities.map(row => ({ id: row.id, status: "accepted" })) }) };
  };
  const storage = { load: async () => clone(saved), save: async snapshot => { saved = clone(snapshot); } };
  const { ActivityQueue } = runtime(fetch);
  const queue = new ActivityQueue("api", storage);
  queue.startSession("first-session");
  queue.startSession("first-session"); // React effect replay.
  queue.setActive(true);
  await queue.flush();
  queue.setActive(false);
  queue.setActive(true);
  queue.startSession("first-session");
  await queue.flush();
  assert.equal(saved.entries.length, 1);
  const first = clone(saved.entries[0].activity);
  assert.deepEqual(first, { id: "first-session", action: "session_started", session_id: "first-session",
    interaction_id: null, interaction_step: null, trackable_type: null, trackable_id: null,
    source: null, occurred_at: first.occurred_at, details: {} });
  assert.deepEqual(requests[0], requests[1]);
  queue.setActive(false);
  // A fresh process restores the old start and adds its own, without relabeling either.
  const restored = new ActivityQueue("api", storage);
  restored.startSession("second-session");
  restored.setActive(true);
  offline = false;
  await restored.flush();
  const last = requests.at(-1).activities;
  assert.deepEqual(last[0], first);
  assert.equal(last[1].id, "second-session");
  assert.equal(last[1].session_id, "second-session");
  assert.equal(saved.entries.length, 0);
});
