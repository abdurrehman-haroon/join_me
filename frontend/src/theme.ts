// The app's design tokens: colours, type, spacing and motion, in one place so every screen
// looks and moves the same way. They follow Apple's Human Interface Guidelines (type sizes,
// 44 pt controls, contrast) and Apple's spring motion; docs/plan.md has the reasoning.

// Every colour has one meaning. Contrast is against `chalk` unless noted.
export const colors = {
  // Main text: 15.3:1.
  ink: "#15201B",
  // Secondary text: 5.1:1 (5.6:1 on white), above the 4.5:1 small text needs.
  secondary: "#5E6B62",
  // The screen behind everything.
  chalk: "#F4F5F0",
  // Cards and rows.
  surface: "#FFFFFF",
  // Hairlines between rows.
  separator: "rgba(21,32,27,0.12)",
  // Every action (Join, Start, the selected tab). White text on it is 8.1:1.
  tint: "#1D5B3A",
  // The fill of a secondary (tinted) button; tint text on it is 6.6:1.
  tintSoft: "#E1EBE4",
  // Urgency only: the last spot, a full game. 5.9:1 on white.
  signal: "#C8102E",
};

// Apple's text styles at the default text size (size / line height, in points). Text
// grows with the iPhone's text size setting; React Native does that by default.
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41 },
  title1: { fontSize: 28, lineHeight: 34 },
  title2: { fontSize: 22, lineHeight: 28 },
  title3: { fontSize: 20, lineHeight: 25 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subheadline: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption1: { fontSize: 12, lineHeight: 16 },
  caption2: { fontSize: 11, lineHeight: 13 },
} as const;

// The display face, kept for place names and titles only: the one loud thing on a screen.
export const displayFont = "BigShoulders";

// Apple's layout margin on iPhone, and the smallest comfortable touch target.
export const margin = 16;
export const minTouch = 44;

// A spring in Apple's terms: `response` is roughly how long it takes in seconds, and
// `dampingFraction` is 1 for no bounce, lower for some. React Native's Animated.spring
// takes stiffness and damping, so this converts (with a mass of 1).
function spring(response: number, dampingFraction: number) {
  return {
    stiffness: (2 * Math.PI / response) ** 2,
    damping: (4 * Math.PI * dampingFraction) / response,
    mass: 1,
  };
}

// The springs the app uses, from the apple-design-motion skill.
export const springs = {
  // A button pressed and released.
  press: spring(0.25, 0.85),
  // A selection moving, such as a tab.
  select: spring(0.3, 0.8),
  // Content that follows a lead movement, such as a card settling as its page arrives.
  follow: spring(0.33, 0.8),
};

// How quickly the 3D camera follows its goal, as spring responses in seconds. The camera
// uses a critically damped spring (no bounce) so moves start and end gently and keep their
// speed when a new swipe changes where it is heading.
export const cameraFollowResponse = 0.2;
export const cameraFlightResponse = 0.8;

// Plain fades, for things appearing and for Reduce Motion, in milliseconds.
export const fadeDuration = 200;
