const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

module.exports = async function handler(req, res) {
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

  const limit = Math.min(
    Math.max(Number(req.query.limit) || 20, 1),
    50
  );

  const sort = String(
    req.query.sort || "latest"
  ).toLowerCase();

  if (!apiKey) {
    return res.status(500).json({
      error: "TWITTER_API_KEY is not configured"
    });
  }

  if (!q) {
    return res.status(400).json({
      error: "Missing q"
    });
  }

  try {
    const sinceTime =
      Math.floor(Date.now() / 1000) -
      minutes * 60;

    const url = new URL(API_URL);

    url.searchParams.set(
      "query",
      `${q} since_time:${sinceTime}`
    );

    url.searchParams.set(
      "queryType",
      "Latest"
    );

    const response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "TwitterAPI.io error",
        details: data
      });
    }

    const rawTweets =
      data.tweets ||
      data.data?.tweets ||
      [];

    const tweets = rawTweets.map((tweet) => {
      const author =
        tweet.author ||
        tweet.user ||
        {};

      const username =
        author.userName ||
        author.username ||
        tweet.userName ||
        "";

      const likes =
        Number(tweet.likeCount) || 0;

      const replies =
        Number(tweet.replyCount) || 0;

      const reposts =
        Number(
          tweet.retweetCount ||
          tweet.repostCount
        ) || 0;

      const quotes =
        Number(tweet.quoteCount) || 0;

      const views =
        Number(tweet.viewCount) || 0;

      const engagement =
        likes +
        replies * 2 +
        reposts * 2 +
        quotes * 2;

      return {
        id: tweet.id,
        text: tweet.text || "",
        username,
        name:
          author.name ||
          tweet.name ||
          "",
        createdAt:
          tweet.createdAt ||
          tweet.created_at ||
          null,
        likes,
        replies,
        reposts,
        quotes,
        views,
        engagement,
        url:
          tweet.twitterUrl ||
          tweet.url ||
          (
            username && tweet.id
              ? `https://x.com/${username}/status/${tweet.id}`
              : null
          )
      };
    });

    const sortedTweets =
      sort === "engagement"
        ? tweets.sort(
            (a, b) =>
              b.engagement -
              a.engagement
          )
        : tweets;

    return res.status(200).json({
      ok: true,
      query: q,
      minutes,
      sort,
      count: Math.min(
        sortedTweets.length,
        limit
      ),
      tweets: sortedTweets.slice(
        0,
        limit
      )
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
};