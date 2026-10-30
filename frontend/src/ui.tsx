import NativeSegmentedControl, {
  type SegmentedControlProps,
} from "@react-native-segmented-control/segmented-control";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState, type ComponentType, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, springs } from "./theme";
import useReduceMotion from "./useReduceMotion";
import useReduceTransparency from "./useReduceTransparency";

// Shared building blocks for the app's controls.

// iOS's own segmented control, for a few closely related choices. The package's class
// typings predate React 19's JSX types, so it is described here by its props instead.
export const SegmentedControl = NativeSegmentedControl as unknown as ComponentType<SegmentedControlProps>;

const liquidGlass = isLiquidGlassAvailable();

// The material for controls floating over the map: Liquid Glass on iOS 26 and later, the
// frosted system material before that, and a solid fill with Reduce Transparency on.
// Only for controls; cards with content stay solid.
export function Glass({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduceTransparency = useReduceTransparency();
  if (reduceTransparency) return <View style={[styles.solid, style]}>{children}</View>;
  if (liquidGlass)
    return (
      <GlassView glassEffectStyle="regular" colorScheme="light" style={style}>
        {children}
      </GlassView>
    );
  return (
    <BlurView tint="systemChromeMaterialLight" intensity={100} style={[styles.blur, style]}>
      {children}
    </BlurView>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  // A light tap on the finger when the press counts, for actions that change something.
  haptic?: boolean;
};

// A button that answers the moment it is touched: it shrinks to 96% and dims a little,
// then springs back on release (Apple's feedback for custom buttons). With Reduce Motion
// it only dims.
export function PressableScale({ style, haptic, onPress, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const reduceMotion = useReduceMotion();
  const [pressed] = useState(() => new Animated.Value(0));

  function springTo(value: number) {
    Animated.spring(pressed, { toValue: value, ...springs.press, useNativeDriver: true }).start();
  }

  const scale = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, reduceMotion ? 1 : 0.96] });
  const opacity = pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        springTo(1);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        springTo(0);
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(event);
      }}
      style={[style, { opacity, transform: [{ scale }] }]}
    />
  );
}

// An SF Symbol, with a plain character where SF Symbols are not available (Android, web).
export function Icon({
  name,
  fallback,
  size = 20,
  color = colors.ink,
}: {
  name: SFSymbol;
  fallback: string;
  size?: number;
  color?: string;
}) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight="semibold"
      fallback={<Text style={{ fontSize: size, lineHeight: size + 4, color }}>{fallback}</Text>}
    />
  );
}

const styles = StyleSheet.create({
  solid: { backgroundColor: colors.chalk },
  blur: { overflow: "hidden" },
});
