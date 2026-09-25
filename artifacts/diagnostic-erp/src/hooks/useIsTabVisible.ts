import { useEffect, useState } from "react";

export function readDocumentTabVisible(visibilityState: DocumentVisibilityState | string | undefined): boolean {
  return visibilityState !== "hidden";
}

/** True while this browser tab is visible. Hidden tabs pause polling. */
export function useIsTabVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : readDocumentTabVisible(document.visibilityState),
  );

  useEffect(() => {
    const onChange = () => setVisible(readDocumentTabVisible(document.visibilityState));
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}
