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
      "signal group"
    ];

    const tweets = rawTweets
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

        const createdAt =
          t.createdAt ||
          t.created_at ||
          null;

        let ageMinutes = minutes;

        if (createdAt) {
          const parsed =
            new Date(createdAt).getTime();

          if (!Number.isNaN(parsed)) {
            ageMinutes = Math.max(
              1,
              (Date.now() - parsed) / 60000
            );
          }
        }

        const engagement =
          likes +
          replies * 2 +
          reposts * 2 +
          quotes * 2;

        const velocity =
          engagement / ageMinutes;

        const lower =
          text.toLowerCase();

        const spam =
          spamWords.some((word) =>
            lower.includes(word)
          );

        return {
          id: t.id,
          text,
          username,
          name:
            author.name ||
            "",
          createdAt,
          likes,
          replies,
          reposts,
          quotes,
          views,
          engagement,
          velocity:
            Number(velocity.toFixed(2)),
          url:
            t.twitterUrl ||
            t.url ||
            (
              username && t.id
                ? `https://x.com/${username}/status/${t.id}`
                : null
            ),
          spam
        };
      })
      .filter((t) => !t.spam)
      .sort((a, b) =>
        b.velocity - a.velocity
      )
      .slice(0, limit)
      .map(({ spam, ...t }) => t);

    return res.status(200).json({
      ok: true,
      mode: "radar",
      topic,
      windowMinutes: minutes,
      count: tweets.length,
      tweets
    });

  } catch (error) {
    return res.status(500).json({
      error: String(error)
    });
  }
};