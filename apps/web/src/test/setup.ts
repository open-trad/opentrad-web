import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  let uuidSequence = 0;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => {
      uuidSequence += 1;
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
    }),
  });
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});
