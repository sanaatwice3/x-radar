const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const apiKey = process.env.TWITTER_API_KEY;
  const q = String(req.query.q || "").trim();

  const minutes = Math.min(
    Math.max(Number(req.query.minutes) || 60, 1),
    10080
  );

  if (!apiKey) {
    return res.status(500).json({
      error: "TWITTER_API_KEY is not configured",
    });
  }

  if (!q) {
    return res.status(400).json({
      error: "Missing q",
    });
  }

  try {
    const sinceTime =
      Math.floor(Date.now() / 1000) - minutes * 60;

    const searchQuery =
      `${q} since_time:${sinceTime}`;

    const url = new URL(API_URL);

    url.searchParams.set("query", searchQuery);
    url.searchParams.set("queryType", "Latest");

    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {