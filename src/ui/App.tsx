// App — thin entry point.
//
// Creates the GameStore singleton and hands it to AppShell.
// All layout, tab routing and responsiveness live in AppShell.

import { useMemo } from "react";
import { DEFAULT_CONTENT } from "../content";
import { createGameStore } from "./store";
import { AppShell } from "./layout/AppShell";

export function App() {
  const store = useMemo(() => createGameStore({ content: DEFAULT_CONTENT }), []);
  return <AppShell store={store} />;
}
