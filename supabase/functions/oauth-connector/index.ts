import { makeHandler } from "./handler.ts";

Deno.serve(makeHandler({ env: (name: string) => Deno.env.get(name), fetch }));
