import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// Follows the iOS Reduce Transparency setting. Glass and blur should become solid when
// this is true, so text over the map stays easy to read.
export default function useReduceTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduceTransparency);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReduceTransparency,
    );
    return () => subscription.remove();
  }, []);
  return reduceTransparency;
}
