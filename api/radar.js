const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const apiKey = process.env.TWITTER_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "TWITTER_API_KEY missing"
    });
  }

  const topic = String(
    req.query.topic || "crypto"
  ).trim();

  const minutes = Math.min(
    Math.max(Number(req.query.minutes) || 60, 5),
    1440
  );

  const limit = Math.min(
    Math.max(Number(req.query.limit) || 10, 1),
    20
  );

  try {
    const since =
      Math.floor(Date.now() / 1000) -
      minutes * 60;

    const query =
      `${topic} since_time:${since} ` +
      `-filter:replies`;

    const url = new URL(API_URL);

    url.searchParams.set("query", query);
    url.searchParams.set("queryType", "Latest");

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

    const raw =
      data.tweets ||
      data.data?.tweets ||
      [];

    const spamWords = [
      "airdrop",
      "join telegram",
      "private alpha",
      "100x",
      "1000x",
      "guaranteed",
      "contract address",
      "ca:",
      "presale",
      "buy now",
      "dm me",
      "vip group"
    ];

    const tweets = raw
      .map((t) => {
        const author =
          t.author ||
          t.user ||
          {};

        const username =
          author.userName ||
          author.username ||
          t.userName ||
          "";

        const text =
          String(t.text || "");

        const likes =
          Number(t.likeCount) || 0;

        const replies =
          Number(t.replyCount) || 0;

        const reposts =
          Number(
            t.retweetCount ||
            t.repostCount
          ) || 0;

        const quotes =
          Number(t.quoteCount) || 0;

        const views =
          Number(t.viewCount) || 0;

        const ageMinutes =
          t.createdAt
            ? Math.max(
                