/// <reference lib="webworker" />

import {
  dispatchLocalConversion,
  installLocalConversionWorker,
  type LocalWorkerScope,
} from "@opentrad/conversion-local/worker-runtime";

installLocalConversionWorker(self as unknown as LocalWorkerScope, dispatchLocalConversion);
