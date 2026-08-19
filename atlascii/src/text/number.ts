/**
 * A number with thousands separators, at measurement precision.
 *
 * Four decimals below 100, two above, because a small measurement needs the
 * precision and a large one is noise.
 */
export const formatNumber = (value: number) => {
  const [whole, fraction] = value.toFixed(value < 100 ? 4 : 2).split(".");
  return `${(whole ?? "").replace(/(?=(?:\d{3})+$)\B/g, ",")}${fraction ? `.${fraction}` : ""}`;
};
