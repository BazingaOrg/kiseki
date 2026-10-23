export interface StripGeometry {
  scrollLeft: number;
  viewportWidth: number;
  scrollWidth: number;
  itemLeft: number;
  itemWidth: number;
  gap: number;
}

export const photoStripTarget = ({scrollLeft, viewportWidth, scrollWidth, itemLeft, itemWidth, gap}: StripGeometry) => {
  const maximum = Math.max(0, scrollWidth - viewportWidth);
  if (!maximum || viewportWidth <= 0) return 0;
  const margin = Math.min((itemWidth + gap) * 2, viewportWidth * 0.35);
  const itemRight = itemLeft + itemWidth;
  const target = itemRight > scrollLeft + viewportWidth - margin
    ? itemRight + margin - viewportWidth
    : itemLeft < scrollLeft + margin ? itemLeft - margin : scrollLeft;
  return Math.max(0, Math.min(maximum, target));
};
