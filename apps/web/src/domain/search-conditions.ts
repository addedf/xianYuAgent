import { areaList } from "@vant/area-data";

export const SEARCH_KEYWORD_LIMIT = 5;

export function parseSearchKeywords(value: string): string[] {
  const seen = new Set<string>();
  const keywords = value.split(/[\n,，;；]+/).map((part) => part.trim()).filter((part) => {
    if (!part || seen.has(part.toLowerCase())) return false;
    seen.add(part.toLowerCase());
    return true;
  });
  if (keywords.length === 0) throw new Error("请至少输入一个关键词。");
  if (keywords.length > SEARCH_KEYWORD_LIMIT) throw new Error(`每次最多搜索 ${SEARCH_KEYWORD_LIMIT} 个关键词。`);
  if (keywords.some((keyword) => keyword.length > 40)) throw new Error("每个关键词最多 40 个字。");
  return keywords;
}

export const provinceOptions = Object.entries(areaList.province_list).map(([code, name]) => ({ code, name }));

export function cityOptions(provinceCode: string) {
  return Object.entries(areaList.city_list)
    .filter(([code]) => code.slice(0, 2) === provinceCode.slice(0, 2))
    .map(([code, name]) => ({ code, name }));
}

function collectorAreaName(name: string): string {
  return name.replace(/特别行政区$|(?:维吾尔|壮族|回族)?自治区$|省$|市$/, "");
}

export function resolveSearchLocation(provinceCode: string, cityCode: string): { province?: string; city?: string } {
  if (!provinceCode) return {};
  const provinceName = areaList.province_list[provinceCode];
  if (!provinceName) throw new Error("请选择有效的省份。");
  if (!cityCode) return { province: collectorAreaName(provinceName) };
  const cityName = areaList.city_list[cityCode];
  if (!cityName || !cityOptions(provinceCode).some(({ code }) => code === cityCode)) throw new Error("请选择该省份下的城市。");
  return { province: collectorAreaName(provinceName), city: collectorAreaName(cityName) };
}
