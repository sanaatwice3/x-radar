const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

async function search(apiKey, query, since) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
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

  return data.tweets || [];
}

module.exports = async function (req, res) {
  try {
    const apiKey = process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "TWITTER_API_KEY missing"
      });
    }

    const minutes = Math.min(
      Math.max(Number(req.query.minutes) || 30, 5),
      1440
    );

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      50
    );

    const since =
      Math.floor(Date.now() / 1000) -
      minutes * 60;

    const queries = [
      "viral OR trending OR breaking OR insane OR wild",
      "meme OR funny OR drama OR controversy OR scandal",
      "crypto OR bitcoin OR ethereum OR solana OR web3 OR nft",
      "AI OR OpenAI OR tech OR robot OR startup",
      "Elon OR Musk OR Trump OR politician OR president",
      "celebrity OR streamer OR creator OR gaming OR sports"
    ];

    const results = await Promise.all(
      queries.map((query) =>
        search(apiKey, query, since)
      )
    );

    const allTweets = results.flat();

    const uniqueTweets = Array.from(
      new Map(
        allTweets.map((tweet) => [
          tweet.id,
          tweet
        ])
      ).values()
    );

    const tweets = uniqueTweets
      .map((tweet) => {
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
          Number(tweet.retweetCount) || 0;

        const quotes =
          Number(tweet.quoteCount) || 0;

        const views =
          Number(tweet.viewCount) || 0;

        const createdAt =
          tweet.createdAt || null;

        let ageMinutes = minutes;

        if (createdAt) {
          const time =
            new Date(createdAt).getTime();

          if (!Number.isNaN(time)) {
            ageMinutes = Math.max(
              1,
              (Date.now() - time) / 60000
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

        return {
          id: tweet.id,
          text: tweet.text || "",
          username,
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
            tweet.twitterUrl ||
            tweet.url ||
            (
              username && tweet.id
                ? `https://x.com/${username}/status/${tweet.id}`
                : null
            )
        };
      })
      .sort((a, b) =>
        b.velocity - a.velocity
      )
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      mode: "all-narratives",
      windowMinutes: minutes,
      sensors: queries.length,
      count: tweets.length,
      tweets
    });

  } catch (error) {
    return res.status(500).json({
      error: String(error)
    });
  }
};