// Shared editorial report primitives — one typed module, no duplicates.
// Used by MatchReport (motståndaranalys) and PlayerDetail (spelarprofil).
export { SectionShell, type SectionShellProps } from "./SectionShell";
export { ClipChip } from "./ClipChip";
export { ClipDrawer } from "./ClipDrawer";
export { SecNavDesktop, SecNavMobile, type SecNavItem } from "./SecNav";
export { useScrollSpy } from "./useScrollSpy";
