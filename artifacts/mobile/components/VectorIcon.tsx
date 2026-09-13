import React from "react";
import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  type SvgProps,
} from "react-native-svg";

type IconProps = {
  name: string;
  size?: number;
  color?: string;
  style?: SvgProps["style"];
  accessibilityLabel?: string;
};

function IconShape({ name, filled }: { name: string; filled?: boolean }) {
  switch (name) {
    case "search":
      return <><Circle cx="11" cy="11" r="7" /><Line x1="16.5" y1="16.5" x2="21" y2="21" /></>;
    case "clock":
      return <><Circle cx="12" cy="12" r="9" /><Polyline points="12 7 12 12 15.5 14" /></>;
    case "map-pin":
      return <><Path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><Circle cx="12" cy="10" r="2.5" /></>;
    case "flag":
      return <><Line x1="5" y1="22" x2="5" y2="3" /><Path d="M5 4h11l-2 4 2 4H5" /></>;
    case "truck":
      return <><Path d="M3 6h11v11H3Z" /><Path d="M14 10h4l3 3v4h-7Z" /><Circle cx="7" cy="18" r="2" /><Circle cx="18" cy="18" r="2" /></>;
    case "user":
      return <><Circle cx="12" cy="8" r="4" /><Path d="M4 21a8 8 0 0 1 16 0" /></>;
    case "users":
      return <><Circle cx="9" cy="8" r="3" /><Path d="M3 20a6 6 0 0 1 12 0" /><Path d="M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" /></>;
    case "plus":
      return <><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></>;
    case "x":
      return <><Line x1="6" y1="6" x2="18" y2="18" /><Line x1="18" y1="6" x2="6" y2="18" /></>;
    case "check":
      return <Polyline points="5 12.5 10 17.5 20 7.5" />;
    case "chevron-left":
      return <Polyline points="15 18 9 12 15 6" />;
    case "chevron-right":
      return <Polyline points="9 18 15 12 9 6" />;
    case "chevron-down":
      return <Polyline points="6 9 12 15 18 9" />;
    case "arrow-right":
      return <><Line x1="5" y1="12" x2="19" y2="12" /><Polyline points="14 7 19 12 14 17" /></>;
    case "repeat":
      return <><Path d="M17 2l4 4-4 4" /><Path d="M3 11V9a3 3 0 0 1 3-3h15" /><Path d="M7 22l-4-4 4-4" /><Path d="M21 13v2a3 3 0 0 1-3 3H3" /></>;
    case "navigation":
      return <Polygon points="3 11 22 2 13 21 11 13 3 11" />;
    case "send":
      return <><Polygon points="22 2 15 22 11 13 2 9 22 2" /><Line x1="11" y1="13" x2="22" y2="2" /></>;
    case "compass":
      return <><Circle cx="12" cy="12" r="9" /><Polygon points="16 8 14 14 8 16 10 10 16 8" /></>;
    case "calendar":
      return <><Rect x="3" y="5" width="18" height="16" rx="2" /><Line x1="3" y1="10" x2="21" y2="10" /><Line x1="8" y1="3" x2="8" y2="7" /><Line x1="16" y1="3" x2="16" y2="7" /></>;
    case "inbox":
      return <><Path d="M4 4h16l2 12h-6l-2 3h-4l-2-3H2L4 4Z" /><Path d="M2 16h6l2 3h4l2-3h6" /></>;
    case "edit-2":
    case "edit-3":
      return <><Path d="M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z" /><Line x1="14.5" y1="7.5" x2="17.5" y2="10.5" /></>;
    case "link":
      return <><Path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><Path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>;
    case "lock":
      return <><Rect x="4" y="10" width="16" height="11" rx="2" /><Path d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
    case "log-in":
      return <><Path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /><Line x1="10" y1="12" x2="21" y2="12" /><Polyline points="17 8 21 12 17 16" /></>;
    case "log-out":
      return <><Path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /><Line x1="14" y1="12" x2="3" y2="12" /><Polyline points="7 8 3 12 7 16" /></>;
    case "external-link":
      return <><Path d="M14 4h6v6" /><Line x1="20" y1="4" x2="11" y2="13" /><Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>;
    case "map":
      return <><Polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" /><Line x1="9" y1="3" x2="9" y2="18" /><Line x1="15" y1="6" x2="15" y2="21" /></>;
    case "tag":
      return <><Path d="M20 13l-7 7-10-10V3h7l10 10Z" /><Circle cx="7.5" cy="7.5" r="1.2" /></>;
    case "globe":
      return <><Circle cx="12" cy="12" r="9" /><Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>;
    case "shield":
      return <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />;
    case "message-circle":
      return <Path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.5 9.5 0 0 1-4-.9L3 21l1.7-4.5A8.5 8.5 0 1 1 21 11.5Z" />;
    case "clipboard":
      return <><Rect x="5" y="4" width="14" height="18" rx="2" /><Rect x="8" y="2" width="8" height="5" rx="1" /></>;
    case "bar-chart-2":
      return <><Line x1="4" y1="20" x2="20" y2="20" /><Line x1="7" y1="16" x2="7" y2="11" /><Line x1="12" y1="16" x2="12" y2="5" /><Line x1="17" y1="16" x2="17" y2="8" /></>;
    case "trending-up":
      return <><Polyline points="3 17 9 11 13 15 21 7" /><Polyline points="15 7 21 7 21 13" /></>;
    case "trending-down":
      return <><Polyline points="3 7 9 13 13 9 21 17" /><Polyline points="15 17 21 17 21 11" /></>;
    case "dollar-sign":
      return <><Line x1="12" y1="2" x2="12" y2="22" /><Path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>;
    case "star":
    case "star-outline":
      return <Polygon points="12 2.5 15 8.5 21.5 9.5 16.8 14.2 18 21 12 17.8 6 21 7.2 14.2 2.5 9.5 9 8.5 12 2.5" fill={name === "star" || filled ? "currentColor" : "none"} />;
    case "alert-circle":
    case "info":
    case "x-circle":
    case "plus-circle":
    case "check-circle":
    case "pause-circle":
      return (
        <>
          <Circle cx="12" cy="12" r="9" />
          {name === "alert-circle" && <><Line x1="12" y1="7" x2="12" y2="13" /><Circle cx="12" cy="17" r=".6" fill="currentColor" /></>}
          {name === "info" && <><Line x1="12" y1="11" x2="12" y2="17" /><Circle cx="12" cy="7.5" r=".6" fill="currentColor" /></>}
          {name === "x-circle" && <><Line x1="9" y1="9" x2="15" y2="15" /><Line x1="15" y1="9" x2="9" y2="15" /></>}
          {name === "plus-circle" && <><Line x1="12" y1="8" x2="12" y2="16" /><Line x1="8" y1="12" x2="16" y2="12" /></>}
          {name === "check-circle" && <Polyline points="8 12.5 11 15.5 16.5 9.5" />}
          {name === "pause-circle" && <><Line x1="10" y1="9" x2="10" y2="15" /><Line x1="14" y1="9" x2="14" y2="15" /></>}
        </>
      );
    default:
      return <Circle cx="12" cy="12" r="4" />;
  }
}

function SvgIcon({ name, size = 24, color = "#000000", style, accessibilityLabel }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      color={color}
      style={style}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
    >
      <IconShape name={name} filled={name === "star"} />
    </Svg>
  );
}

export const Feather = SvgIcon;
export const AntDesign = SvgIcon;
export const Ionicons = SvgIcon;