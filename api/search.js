export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "GET only" });
  }

  const bearerToken = process.env.X_BEARER_TOKEN;
  const q = String(req.query.q || "").trim();
  const minutes = Math.min(
    Math.max(Number(req.query.minutes) || 60, 1),
    10080
  );

  if (!bearerToken) {
    return res.status(500).json({
      error: "X_BEARER_TOKEN is not configured",
    });
  }

  if (!q) {
    return res.status(400).json({
      error: "Missing q",
    });
  }

  try {
    const startTime = new Date(
      Date.now() - minutes * 60 * 1000
    ).toISOString();

    const url = new URL(
      "https://api.x.com/2/tweets/search/recent"
    );

    url.searchParams.set("query", q);
    url.searchParams.set("start_time", startTime);
    url.searchParams.set("max_results", "10");
    url.searchParams.set(
      "tweet.fields",
      "created_at,public_metrics,author_id,lang"
    );
    url.searchParams.set(
      "expansions",
      "author_id"
    );
    url.searchParams.set(
      "user.fields",
      "username,name"
    );

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "X API error",
        details: data,
      });
    }

    return res.status(200).json({
      ok: true,
      query: q,
      minutes,
      fetchedAt: new Date().toISOString(),
      count: data.meta?.result_count || 0,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
}