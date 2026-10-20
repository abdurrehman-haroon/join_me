import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// Follows the iOS/Android Reduce Motion setting. Motion that only decorates
// (camera glides, number rolls) should become instant when this is true.
export default function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);
  return reduceMotion;
}
