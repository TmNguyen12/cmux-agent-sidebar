// Loads sidebars/agents.js the way cmux does (one script, no modules) inside a
// node:vm context with the cmux runtime globals stubbed. Top-level `function`
// declarations become context properties, so tests call the model directly.
//
// The view stubs evaluate every zero-arg function they are handed (bindings
// and tap handlers alike) and expand ForEach over its items, so a render runs
// every row builder and binding once against the fixture data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../sidebars/agents.js", import.meta.url)),
  "utf8",
);

const VIEWS = [
  "VStack", "HStack", "ZStack", "LazyVStack", "Group", "Text", "Image",
  "Button", "Spacer", "Divider", "Circle", "Capsule", "Rectangle",
  "RoundedRectangle", "ProgressView",
];

export function loadSidebar({ workspaces = [], epoch = 0, time = "00:00:00" } = {}) {
  const cmuxCalls = [];

  const exercise = (args) => {
    for (const a of args) {
      if (typeof a === "function" && a.length === 0) a();
      if (Array.isArray(a)) exercise(a);
    }
  };

  const view = () => {
    const node = new Proxy({}, {
      get: () => (...args) => {
        exercise(args);
        return node;
      },
    });
    return node;
  };

  const ctx = {
    console,
    data: {
      workspaces: () => workspaces,
      clock: () => ({ epoch, time }),
    },
    signal: (v) => {
      let cur = v;
      return [() => cur, (n) => { cur = n; }];
    },
    computed: (fn) => fn,
    cmux: (method, params) => cmuxCalls.push({ method, params }),
    sidebar: (fn) => { ctx.__render = fn; },
    ForEach: ({ items, key }, template) => {
      for (const item of items()) template(() => item, key(item));
      return view();
    },
    __cmuxCalls: cmuxCalls,
  };
  for (const name of VIEWS) {
    ctx[name] = (...args) => {
      exercise(args);
      return view();
    };
  }

  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: "agents.js" });
  return ctx;
}

// Fixture helpers: the shape cmux documents for data.workspaces().
export const ws = (id, extra = {}) => ({
  id, title: id, selected: false, tabs: [], ...extra,
});

export const agent = (id, status, extra = {}) => ({
  id, kind: "claude", name: "Claude Code", status, lastActivityAt: 1000, ...extra,
});
