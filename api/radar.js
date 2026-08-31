const API_URL = "https://api.twitterapi.io/twitter/tweet/advanced_search";

module.exports = async function (req, res) {
  try {
    const apiKey = process.env.TWITTER_API_KEY;
    const topic = String(req.query.topic || "crypto");
    const minutes = Number(req.query.minutes || 30);
    const limit = Number(req.query.limit || 10);

    const since =
      Math.floor(Date.now() / 1000) - minutes * 60;

    const url = new URL(API_URL);
    url.searchParams.set(
      "query",
      `${topic} since_time:${since}`
    );
    url.searchParams.set("queryType", "Latest");

    const r = await fetch(url, {
      headers: { "X-API-Key": apiKey }
    });

    const data = await r.json();

    const raw = data.tweets || [];

    const tweets = raw.slice(0, limit).map((t) => ({
      id: t.id,
      text: t.text || "",
      username:
        t.author?.userName ||
        t.userName ||
        "",
      createdAt: t.createdAt || null,
      likes: Number(t.likeCount) || 0,
      replies: Number(t.replyCount) || 0,
      reposts: Number(t.retweetCount) || 0,
      views: Number(t.viewCount) || 0,
      url: t.twitterUrl || t.url || null
    }));

    return res.status(200).json({
      ok: true,
      topic,
      minutes,
      count: tweets.length,
      tweets
    });
  } catch (e) {
    return res.status(500).json({
      error: String(e)
    });
  }
};