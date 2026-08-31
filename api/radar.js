const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const apiKey = process.env.TWITTER_API_KEY;

    const topic = String(
      req.query.topic || "crypto"
    ).trim();

    const minutes = Math.min(
      Math.max(Number(req.query.minutes) || 30, 1),
      1440
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 10, 1),
      20
    );

    if (!apiKey) {
      return res.status(500).json({
        error: "TWITTER_API_KEY missing"
      });
    }

    const sinceTime =
      Math.floor(Date.now() / 1000) -
      minutes * 60;

    const url = new URL(API_URL);

    url.searchParams.set(
      "query",
      `${topic} since_time:${sinceTime}`
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

    const spamWords = [
      "join telegram",
      "private alpha",
      "vip group",
      "100x",
      "1000x",
      "guaranteed",
      "buy now",
      "presale",
      "contract address",
      "dm me",
      "signal