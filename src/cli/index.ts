#!/usr/bin/env node
// tslint:disable no-console

import { main } from "./cli";

main(process.argv).catch(e => console.error(e));
