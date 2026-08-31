const API_URL =
  "https://api.twitterapi.io/twitter/tweet/advanced_search";

const STOP_WORDS = new Set([
  "this","that","with","from","have","will","your","what","when","where",
  "about","they","their","there","would","could","should","just","been",
  "into","more","than","some","very","here","were","them","then","also",
  "only","over","after","before","because","while","really","still",
  "going","make","made","today","right","people","thing","things","like",
  "said","says","saying","breaking","viral","trending","news","update",
  "thread","watch","look","https","http","the","and","for","are","was",
  "you","but","not","all","can","out","has","had","its","our","who",
  "how","why","now","new","get","got","one","two","too"
]);

const BLOCKED = [
  "join telegram",
  "telegram group",
  "signal group",
  "private alpha",
  "contract address",
  "drop your wallet",
  "send wallet",
  "presale",
  "100x",
  "1000x",
  "buy now",
  "dm me",
  "stay locked in"
];

const SENSORS = [
  "breaking OR confirmed OR announced OR launch",
  "viral OR trending OR controversy OR scandal OR drama",
  "meme OR funny OR weird OR absurd OR insane",
  "crypto OR blockchain OR web3 OR nft OR defi OR stablecoin",
  "mainnet OR testnet OR protocol OR network OR chain OR rollup",
  "listing OR partnership OR acquisition OR funding OR investment",
  "exchange OR wallet OR dex OR bridge OR prediction market",
  "AI OR OpenAI OR technology OR robot OR startup",
  "CEO OR founder OR president OR politician OR government",
  "celebrity OR streamer OR gaming OR sports",
  "market OR stock OR ETF OR treasury OR institutional",
  "Elon OR Musk OR Trump OR Robinhood OR Coinbase OR Binance"
];

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function tweetArray(data) {
  if (Array.isArray(data?.tweets)) return data.tweets;
  if (Array.isArray(data?.data?.tweets)) return data.data.tweets;
  return [];
}

async function getPage(apiKey, query, since, cursor) {
  const url = new URL(API_URL);

  url.searchParams.set(
    "query",
    `${query} since_time:${since}`
  );

  url.searchParams.set("queryType", "Latest");

  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey
    }
  });

  if (!response.ok) {
    return {
      tweets: [],
      nextCursor: null,
      hasNext: false,
      status: response.status
    };
  }

  const data = await response.json();

  return {
    tweets: tweetArray(data),

    nextCursor:
      data?.next_cursor ||
      data?.nextCursor ||
      null,

    hasNext:
      data?.has_next_page ??
      data?.hasNextPage ??
      Boolean(
        data?.next_cursor ||
        data?.nextCursor
      ),

    status: response.status
  };
}

async function collectSensor(
  apiKey,
  query,
  since,
  maxPages
) {
  const tweets = [];
  const seen = new Set();

  let cursor = null;
  let pagesFetched = 0;

  for (
    let pageNumber = 0;
    pageNumber < maxPages;
    pageNumber++
  ) {
    const page = await getPage(
      apiKey,
      query,
      since,
      cursor
    );

    pagesFetched++;

    for (const tweet of page.tweets) {
      if (!tweet?.id) continue;

      if (!seen.has(tweet.id)) {
        seen.add(tweet.id);
        tweets.push(tweet);
      }
    }

    if (
      !page.hasNext ||
      !page.nextCursor
    ) {
      break;
    }

    if (page.nextCursor === cursor) {
      break;
    }

    cursor = page.nextCursor;
  }

  return {
    query,
    pagesFetched,
    count: tweets.length,
    tweets
  };
}

function cleanText(text = "") {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cryptoAddress(text = "") {
  const evm =
    /\b0x[a-fA-F0-9]{40}\b/;

  const solana =
    /\b[1-9A-HJ-NP-Za-km-z]{32,44}(?:pump)?\b/;

  return (
    evm.test(text) ||
    solana.test(text)
  );
}

function isNoise(text = "") {
  const t = text
    .toLowerCase()
    .trim();

  if (!t) return true;

  if (t.startsWith("@")) {
    return true;
  }

  if (
    BLOCKED.some(
      (phrase) =>
        t.includes(phrase)
    )
  ) {
    return true;
  }

  if (
    t.includes("ca:") ||
    t.includes("contract:")
  ) {
    return true;
  }

  if (
    cryptoAddress(text) &&
    (
      t.includes("moon") ||
      t.includes("entry") ||
      t.includes("ape") ||
      t.includes("mc")
    )
  ) {
    return true;
  }

  if (cleanText(text).length < 15) {
    return true;
  }

  return false;
}

function ageBoost(age) {
  if (age <= 1) return 5;
  if (age <= 2) return 4;
  if (age <= 5) return 3;
  if (age <= 10) return 2;
  if (age <= 20) return 1.3;

  return 1;
}

function extractKeywords(text = "") {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(
      /[^\p{L}\p{N}#$\s]/gu,
      " "
    )
    .toLowerCase();

  const output = [];

  for (
    const word of cleaned
      .split(/\s+/)
      .filter(Boolean)
  ) {
    if (word.length < 3) continue;
    if (STOP_WORDS.has(word)) continue;

    if (!output.includes(word)) {
      output.push(word);
    }

    if (output.length >= 20) break;
  }

  return output;
}

function extractEntities(text = "") {
  const cleaned =
    cleanText(text);

  const caps =
    cleaned.match(
      /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g
    ) || [];

  const tickers =
    cleaned.match(
      /\$[A-Za-z][A-Za-z0-9]{1,10}/g
    ) || [];

  const hashtags =
    cleaned.match(
      /#[A-Za-z][A-Za-z0-9_]{2,30}/g
    ) || [];

  return [
    ...new Set(
      [
        ...caps,
        ...tickers,
        ...hashtags
      ]
        .map((x) =>
          x.toLowerCase()
        )
        .filter(
          (x) =>
            x.length >= 3
        )
    )
  ].slice(0, 12);
}

function jaccard(a, b) {
  if (!a.length || !b.length) {
    return 0;
  }

  const A = new Set(a);
  const B = new Set(b);

  let shared = 0;

  for (const x of A) {
    if (B.has(x)) {
      shared++;
    }
  }

  return (
    shared /
    new Set([...A, ...B]).size
  );
}

function clusterMatch(a, b) {
  const entityMatch =
    a.entities.some(
      (x) =>
        x.length >= 4 &&
        b.entities.includes(x)
    );

  if (entityMatch) {
    return true;
  }

  const common =
    a.keywords.filter(
      (x) =>
        b.keywords.includes(x)
    );

  if (common.length >= 2) {
    return true;
  }

  return (
    jaccard(
      a.keywords,
      b.keywords
    ) >= 0.2
  );
}

function buildClusters(tweets) {
  const clusters = [];

  for (const tweet of tweets) {
    let target = null;

    for (const cluster of clusters) {
      if (
        cluster.some(
          (member) =>
            clusterMatch(
              tweet,
              member
            )
        )
      ) {
        target = cluster;
        break;
      }
    }

    if (target) {
      target.push(tweet);
    } else {
      clusters.push([tweet]);
    }
  }

  return clusters;
}

function narrativeName(cluster) {
  const entityCounts = {};
  const keywordCounts = {};

  for (const tweet of cluster) {
    for (const x of tweet.entities) {
      entityCounts[x] =
        (entityCounts[x] || 0) + 1;
    }

    for (const x of tweet.keywords) {
      keywordCounts[x] =
        (keywordCounts[x] || 0) + 1;
    }
  }

  const entities =
    Object.entries(entityCounts)
      .filter(
        ([, count]) =>
          count >= 2
      )
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
      .slice(0, 3)
      .map(([x]) => x);

  if (entities.length) {
    return entities.join(" ");
  }

  return Object.entries(keywordCounts)
    .sort(
      (a, b) =>
        b[1] - a[1]
    )
    .slice(0, 4)
    .map(([x]) => x)
    .join(" ");
}

function processTweet(tweet, windowMinutes) {
  const author =
    tweet.author ||
    tweet.user ||
    {};

  const username =
    author.userName ||
    author.username ||
    tweet.userName ||
    "";

  const text =
    tweet.text || "";

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

  let ageMinutes =
    windowMinutes;

  if (tweet.createdAt) {
    const ts =
      new Date(
        tweet.createdAt
      ).getTime();

    if (!Number.isNaN(ts)) {
      ageMinutes =
        Math.max(
          0.25,
          (
            Date.now() -
            ts
          ) / 60000
        );
    }
  }

  const engagement =
    likes +
    replies * 2 +
    reposts * 3 +
    quotes * 3;

  const velocity =
    engagement /
    ageMinutes;

  const earlyScore =
    velocity *
      ageBoost(ageMinutes) +
    Math.log10(views + 1);

  return {
    id: tweet.id,
    text,
    username,

    createdAt:
      tweet.createdAt || null,

    ageMinutes:
      Number(
        ageMinutes.toFixed(2)
      ),

    likes,
    replies,
    reposts,
    quotes,
    views,
    engagement,

    velocity:
      Number(
        velocity.toFixed(2)
      ),

    earlyScore:
      Number(
        earlyScore.toFixed(2)
      ),

    keywords:
      extractKeywords(text),

    entities:
      extractEntities(text),

    url:
      tweet.twitterUrl ||
      tweet.url ||
      (
        username
          ? `https://x.com/${username}/status/${tweet.id}`
          : null
      )
  };
}

module.exports = async function (req, res) {
  try {
    const apiKey =
      process.env.TWITTER_API_KEY;

    if (!apiKey) {
      return res
        .status(500)
        .json({
          error:
            "TWITTER_API_KEY missing"
        });
    }

    const minutes =
      clamp(
        req.query.minutes,
        5,
        1440,
        30
      );

    const limit =
      clamp(
        req.query.limit,
        1,
        50,
        20
      );

    const pages =
      clamp(
        req.query.pages,
        1,
        5,
        3
      );

    const since =
      Math.floor(
        Date.now() / 1000
      ) -
      minutes * 60;

    const sensorResults =
      await Promise.all(
        SENSORS.map(
          (query) =>
            collectSensor(
              apiKey,
              query,
              since,
              pages
            )
        )
      );

    const raw =
      sensorResults.flatMap(
        (x) => x.tweets
      );

    const unique =
      Array.from(
        new Map(
          raw.map(
            (tweet) => [
              tweet.id,
              tweet
            ]
          )
        ).values()
      );

    const processed =
      unique
        .map(
          (tweet) =>
            processTweet(
              tweet,
              minutes
            )
        )
        .filter(
          (tweet) =>
            !isNoise(
              tweet.text
            )
        )
        .filter(
          (tweet) => {
            if (
              tweet.ageMinutes <= 5
            ) {
              return (
                tweet.engagement > 0 ||
                tweet.views >= 3
              );
            }

            return (
              tweet.engagement > 0 ||
              tweet.views >= 15
            );
          }
        )
        .sort(
          (a, b) =>
            b.earlyScore -
            a.earlyScore
        );

    const clusters =
      buildClusters(
        processed
      );

    const narratives =
      clusters
        .map((cluster) => {
          const accounts =
            new Set(
              cluster
                .map(
                  (x) =>
                    x.username
                )
                .filter(Boolean)
            );

          const uniqueAccounts =
            accounts.size;

          const mentions =
            cluster.length;

          const avgAge =
            cluster.reduce(
              (sum, x) =>
                sum +
                x.ageMinutes,
              0
            ) / mentions;

          const engagement =
            cluster.reduce(
              (sum, x) =>
                sum +
                x.engagement,
              0
            );

          const views =
            cluster.reduce(
              (sum, x) =>
                sum +
                x.views,
              0
            );

          const velocity =
            cluster.reduce(
              (sum, x) =>
                sum +
                x.velocity,
              0
            );

          const accountBoost =
            uniqueAccounts >= 5
              ? 4
              : uniqueAccounts >= 3
                ? 2.8
                : uniqueAccounts >= 2
                  ? 1.8
                  : 1;

          const burstBoost =
            avgAge <= 2
              ? 3
              : avgAge <= 5
                ? 2
                : avgAge <= 10
                  ? 1.4
                  : 1;

          const score =
            (
              velocity +
              Math.log10(
                views + 1
              ) +
              mentions
            ) *
            accountBoost *
            burstBoost;

          let status = "WATCH";

          if (
            uniqueAccounts >= 2 &&
            avgAge <= 5
          ) {
            status = "EARLY";
          }

          if (
            uniqueAccounts >= 3 &&
            score >= 25
          ) {
            status = "RISING";
          }

          if (
            uniqueAccounts >= 5 &&
            score >= 80
          ) {
            status = "BREAKING";
          }

          return {
            narrative:
              narrativeName(
                cluster
              ),

            status,
            mentions,
            uniqueAccounts,

            avgAgeMinutes:
              Number(
                avgAge.toFixed(2)
              ),

            engagement,
            views,

            velocity:
              Number(
                velocity.toFixed(2)
              ),

            score:
              Number(
                score.toFixed(2)
              ),

            topTweets:
              [...cluster]
                .sort(
                  (a, b) =>
                    b.earlyScore -
                    a.earlyScore
                )
                .slice(0, 4)
                .map((x) => ({
                  username:
                    x.username,

                  text:
                    x.text,

                  ageMinutes:
                    x.ageMinutes,

                  engagement:
                    x.engagement,

                  views:
                    x.views,

                  url:
                    x.url
                }))
          };
        })
        .filter(
          (x) =>
            x.uniqueAccounts >= 2
        )
        .sort(
          (a, b) =>
            b.score - a.score
        )
        .slice(0, limit);

    const signals =
      processed
        .filter(
          (x) =>
            x.ageMinutes <= 5
        )
        .slice(0, 15)
        .map((x) => ({
          text: x.text,
          username: x.username,
          ageMinutes: x.ageMinutes,
          engagement: x.engagement,
          views: x.views,
          score: x.earlyScore,
          url: x.url
        }));

    const sensorStats =
      sensorResults.map(
        (x) => ({
          query: x.query,
          pages: x.pagesFetched,
          tweets: x.count
        })
      );

    return res
      .status(200)
      .json({
        ok: true,

        mode:
          "narrative-radar-v2",

        windowMinutes:
          minutes,

        pagesRequested:
          pages,

        sensors:
          SENSORS.length,

        rawFetched:
          raw.length,

        scanned:
          unique.length,

        qualified:
          processed.length,

        narrativeCount:
          narratives.length,

        narratives,

        signals,

        sensorStats
      });

  } catch (error) {
    return res
      .status(500)
      .json({
        error:
          String(error)
      });
  }
};