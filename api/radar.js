const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

async function search(apiKey, query, since) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
  );

  url.searchParams.set("queryType", "Latest");

  const r = await fetch(url, {
    headers: {
      "X-API-Key": apiKey
    }
  });

  const data = await r.json();

  return data.tweets || [];
}

function isNoise(text = "") {
  const t = text.toLowerCase().trim();

  if (!t) return true;
  if (t.startsWith("@")) return true;

  const blocked = [
    "good morning",
    "gmorning",
    "contract address",
    "ca:",
    "join telegram",
    "signal group",
    "presale",
    "100x",
    "1000x",
    "buy now",
    "dm me",
    "stay locked in"
  ];

  return blocked.some((x) => t.includes(x));
}

function ageBoost(ageMinutes) {
  if (ageMinutes <= 2) return 4;
  if (ageMinutes <= 5) return 3;
  if (ageMinutes <= 10) return 2;
  if (ageMinutes <= 20) return 1.3;

  return 1;
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
      "viral OR trending OR breaking OR insane",
      "meme OR controversy OR scandal OR drama",
      "crypto OR bitcoin OR ethereum OR solana OR web3 OR nft",
      "AI OR OpenAI OR tech OR robot",
      "Elon OR Musk OR Trump OR president",
      "celebrity OR streamer OR gaming OR sports"
    ];

    const groups = await Promise.all(
      queries.map((q) =>
        search(apiKey, q, since)
      )
    );

    const unique = Array.from(
      new Map(
        groups
          .flat()
          .map((t) => [t.id, t])
      ).values()
    );

    const tweets = unique
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

        const text = t.text || "";

        const likes =
          Number(t.likeCount) || 0;

        const replies =
          Number(t.replyCount) || 0;

        const reposts =
          Number(t.retweetCount) || 0;

        const quotes =
          Number(t.quoteCount) || 0;

        const views =
          Number(t.viewCount) || 0;

        const createdAt =
          t.createdAt || null;

        let ageMinutes = minutes;

        if (createdAt) {
          const timestamp =
            new Date(createdAt).getTime();

          if (!Number.isNaN(timestamp)) {
            ageMinutes = Math.max(
              1,
              (Date.now() - timestamp) / 60000
            );
          }
        }

        const engagement =
          likes +
          replies * 2 +
          reposts * 3 +
          quotes * 3;

        const velocity =
          engagement / ageMinutes;

        const boost =
          ageBoost(ageMinutes);

        const earlyScore =
          velocity * boost +
          Math.log10(views + 1);

        let status = "WATCH";

        if (
          ageMinutes <= 5 &&
          earlyScore >= 10
        ) {
          status = "EARLY";
        }

        if (
          ageMinutes <= 10 &&
          earlyScore >= 30
        ) {
          status = "RISING";
        }

        if (earlyScore >= 100) {
          status = "BREAKING";
        }

        return {
          id: t.id,
          text,
          username,
          createdAt,
          ageMinutes: Number(
            ageMinutes.toFixed(1)
          ),
          likes,
          replies,
          reposts,
          quotes,
          views,
          engagement,
          velocity: Number(
            velocity.toFixed(2)
          ),
          earlyScore: Number(
            earlyScore.toFixed(2)
          ),
          status,
          url:
            t.twitterUrl ||
            t.url ||
            (
              username
                ? `https://x.com/${username}/status/${t.id}`
                : null
            )
        };
      })
      .filter((t) => !isNoise(t.text))
      .filter(
        (t) =>
          t.engagement > 0 ||
          t.views >= 50
      )
      .sort(
        (a, b) =>
          b.earlyScore - a.earlyScore
      )
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      mode: "early-signal",
      windowMinutes: minutes,
      scanned: unique.length,
      count: tweets.length,
      tweets
    });

  } catch (e) {
    return res.status(500).json({
      error: String(e)
    });
  }
};