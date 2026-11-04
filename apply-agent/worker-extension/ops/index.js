// Every op the worker extension runs, by name. Each slice adds its own file and one line here.

import { ops as core } from "./core.js";

export const ops = { ...core };
