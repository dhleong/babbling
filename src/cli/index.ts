#!/usr/bin/env node
/* eslint-disable no-console */

import { main } from "./cli";

main(process.argv).catch(e => console.error(e));
