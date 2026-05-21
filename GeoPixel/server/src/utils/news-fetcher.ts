import fs from "node:fs";
import path from "node:path";

export interface NewsItem {
  title: string;
  url: string;
  fetchedAt: number;
}

interface NewsCache {
  fetchedAt: number;
  items: NewsItem[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124";

/** Maps world name keywords → news page URLs to scrape */
const LOCATION_NEWS_URLS: { pattern: RegExp; urls: string[] }[] = [
  {
    pattern: /tongji|同济/i,
    urls: ["https://news.tongji.edu.cn/"],
  },
  {
    pattern: /复旦|fudan/i,
    urls: ["https://news.fudan.edu.cn/"],
  },
  {
    pattern: /交通大学|jiaotong/i,
    urls: ["https://news.sjtu.edu.cn/"],
  },
];

function resolveNewsUrl(worldName: string): string {
  for (const entry of LOCATION_NEWS_URLS) {
    if (entry.pattern.test(worldName)) return entry.urls[0];
  }
  // generic fallback: search Bing for the location name + 新闻
  const q = encodeURIComponent(`${worldName} 最新新闻`);
  return `https://cn.bing.com/search?q=${q}&freshness=Day`;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseTitles(html: string): string[] {
  const titles: string[] = [];

  // Match title attributes on anchor tags with Chinese content
  const titleAttr = html.matchAll(/title="([^"]{8,80})"/g);
  for (const m of titleAttr) {
    const t = m[1].trim();
    if (/[一-鿿]/.test(t) && !titles.includes(t)) titles.push(t);
  }

  // Match anchor link text with Chinese content
  const linkText = html.matchAll(/<a[^>]*>\s*([^\s<][^<]{6,70})\s*<\/a>/g);
  for (const m of linkText) {
    const t = m[1].trim().replace(/\s+/g, " ");
    if (/[一-鿿]/.test(t) && !titles.includes(t)) titles.push(t);
  }

  return titles
    .filter((t) => !/^(首页|新闻网|更多|导航|登录|搜索|版权)/.test(t))
    .slice(0, 8);
}

function parseTitlesWithUrls(html: string, baseUrl: string): NewsItem[] {
  const now = Date.now();
  const items: NewsItem[] = [];
  const seen = new Set<string>();

  const base = new URL(baseUrl);

  const re = /<a\s+[^>]*href="([^"]+)"[^>]*(?:title="([^"]{8,80})")?[^>]*>\s*(?:([^\s<][^<]{6,70}))?\s*<\/a>/g;
  for (const m of html.matchAll(re)) {
    const href = m[1];
    const titleAttr = m[2]?.trim();
    const linkText = m[3]?.trim().replace(/\s+/g, " ");
    const text = titleAttr || linkText || "";
    if (!text || seen.has(text)) continue;
    if (!/[一-鿿]/.test(text)) continue;
    if (/^(首页|新闻网|更多|导航|登录|搜索|版权|English)/.test(text)) continue;

    let fullUrl = href;
    try {
      fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
    } catch {}

    seen.add(text);
    items.push({ title: text, url: fullUrl, fetchedAt: now });
    if (items.length >= 8) break;
  }

  return items;
}

export async function fetchLocationNews(worldName: string, cacheDir: string): Promise<NewsItem[]> {
  const cachePath = path.join(cacheDir, "news-cache.json");

  // Try cache first
  if (fs.existsSync(cachePath)) {
    try {
      const cached: NewsCache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.items.length > 0) {
        console.log(`[NewsFetcher] Using cached news (${cached.items.length} items)`);
        return cached.items;
      }
    } catch {}
  }

  const url = resolveNewsUrl(worldName);
  console.log(`[NewsFetcher] Fetching news for "${worldName}" from ${url}`);

  try {
    const html = await fetchHtml(url);
    const items = parseTitlesWithUrls(html, url);

    if (items.length > 0) {
      const cache: NewsCache = { fetchedAt: Date.now(), items };
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
      console.log(`[NewsFetcher] Fetched ${items.length} news items, cached.`);
      return items;
    }

    // Fallback: plain title parse
    const titles = parseTitles(html);
    const fallbackItems = titles.map((t) => ({ title: t, url, fetchedAt: Date.now() }));
    if (fallbackItems.length > 0) {
      fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), items: fallbackItems }, null, 2), "utf-8");
    }
    return fallbackItems;
  } catch (e) {
    console.warn(`[NewsFetcher] Failed to fetch news:`, e);
    return [];
  }
}
