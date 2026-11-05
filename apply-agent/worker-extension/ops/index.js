// Every op the worker extension runs, by name. Each slice adds its own file and one line here.

import { ops as accounts } from "./accounts.js";
import { ops as claude } from "./claude.js";
import { ops as core } from "./core.js";
import { ops as dom } from "./dom.js";
import { ops as engine } from "./engine.js";
import { ops as guard } from "./guard.js";
import { ops as records } from "./records.js";
import { ops as tabs } from "./tabs.js";
import { ops as tile } from "./tile.js";

export const ops = { ...core, ...tabs, ...engine, ...dom, ...guard, ...tile, ...records, ...accounts, ...claude };
