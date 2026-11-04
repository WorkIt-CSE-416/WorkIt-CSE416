// Every op the worker extension runs, by name. Each slice adds its own file and one line here.

import { ops as claude } from "./claude.js";
import { ops as core } from "./core.js";
import { ops as dom } from "./dom.js";
import { ops as engine } from "./engine.js";
import { ops as tabs } from "./tabs.js";

export const ops = { ...core, ...tabs, ...engine, ...dom, ...claude };
